const {
  AgendaStatus,
  AgendaTipo,
  Prisma,
  MovimentacaoStatus,
} = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const selfMachineService = require("./selfMachineService");

const MOVIMENTACAO_TIPO = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAIDA",
  TRANSFERENCIA: "TRANSFERENCIA",
  AJUSTE_SALDO: "AJUSTE_SALDO",
};

const AJUSTE_SALDO_OPERACAO = {
  SOMAR: "SOMAR",
  SUBTRAIR: "SUBTRAIR",
};

const TIPOS_DESPESA_CUSTO_FIXO = [
  "DESPESAS_ADMINISTRATIVAS",
  "RETIRADA_SOCIOS",
  "FOLHA_PAGAMENTO",
];

const TIPOS_DESPESA_CUSTO_VARIAVEL = [
  "DESPESAS_DIVERSAS",
  "GASOLINA",
  "MATERIAL_ESCRITORIO",
  "MATERIAL_ESTOQUE_EMBALAGENS",
  "CUSTOS_OPERACIONAIS",
];

/**
 * Converte um valor numerico para Decimal do Prisma.
 * @param {number | string} value Valor bruto.
 * @returns {Prisma.Decimal}
 */
function toDecimal(value) {
  return new Prisma.Decimal(value);
}

/**
 * Normaliza rótulos legíveis para campos enum.
 * @param {string | undefined | null} value Valor bruto do enum.
 * @returns {string | null}
 */
function formatEnumLabel(value) {
  if (!value) {
    return null;
  }

  return String(value).replaceAll("_", " ");
}

/**
 * Verifica se a empresa selecionada e a SelfMachine.
 * @param {string} nomeEmpresa
 * @returns {boolean}
 */
function isSelfMachineEmpresa(nomeEmpresa) {
  return (
    String(nomeEmpresa || "")
      .trim()
      .toLowerCase() === "selfmachine"
  );
}

/**
 * Retorna inicio/fim do mes da data informada.
 * @param {Date} date
 * @returns {{ start: Date, end: Date }}
 */
function monthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  return { start, end };
}

/**
 * Cria item de agenda automaticamente para movimentacoes previstas.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx Cliente transacional.
 * @param {object} payload Dados recebidos da movimentacao.
 * @returns {Promise<void>}
 */
async function createAgendaFromPrevisto(tx, payload, options = {}) {
  const isPrevisto = payload.status === MovimentacaoStatus.PREVISTO;
  const isSupportedType =
    payload.tipo === MOVIMENTACAO_TIPO.ENTRADA ||
    payload.tipo === MOVIMENTACAO_TIPO.SAIDA;

  if (!isPrevisto || !isSupportedType) {
    return;
  }

  const agendaTipo =
    payload.tipo === MOVIMENTACAO_TIPO.SAIDA
      ? AgendaTipo.PAGAR
      : AgendaTipo.RECEBER;
  const descricaoParts = [
    options.marker || null,
    formatEnumLabel(payload.categoria),
    formatEnumLabel(payload.tipoDespesa),
    payload.centroOperacao?.trim() || null,
  ].filter(Boolean);

  await tx.agenda.create({
    data: {
      data: new Date(payload.data),
      titulo:
        payload.referencia?.trim() ||
        (agendaTipo === AgendaTipo.PAGAR
          ? "Lançamento previsto a pagar"
          : "Lançamento previsto a receber"),
      descricao: descricaoParts.length ? descricaoParts.join(" | ") : null,
      origem: payload.canalOrigem?.trim() || null,
      valor: toDecimal(payload.valor),
      prioridade: "MEDIA",
      status: AgendaStatus.PREVISTO,
      tipo: agendaTipo,
      empresaId: Number(payload.empresaId),
    },
  });
}

/**
 * Remove item de agenda gerado automaticamente para uma movimentacao prevista.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx Cliente transacional.
 * @param {number} movimentacaoId Identificador da movimentacao.
 * @returns {Promise<void>}
 */
async function deleteAutoAgendaForMovimentacao(tx, movimentacaoId) {
  const marker = `[AUTO_MOV_ID:${movimentacaoId}]`;

  await tx.agenda.deleteMany({
    where: {
      descricao: {
        contains: marker,
      },
    },
  });
}

/**
 * Busca a empresa da movimentacao.
 * @param {number} empresaId Identificador da empresa.
 * @returns {Promise<import("@prisma/client").Empresa>}
 */
async function getEmpresaOrFail(empresaId, client = prisma) {
  const empresa = await client.empresa.findUnique({
    where: { id: Number(empresaId) },
  });

  if (!empresa) {
    throw new AppError("Empresa nao encontrada.", 404);
  }

  return empresa;
}

/**
 * Busca uma conta bancaria e garante sua existencia.
 * @param {number | undefined | null} contaId Identificador da conta.
 * @param {string} fieldName Nome logico do campo.
 * @returns {Promise<import("@prisma/client").ContaBancaria | null>}
 */
async function getContaOrFail(contaId, fieldName, client = prisma) {
  if (!contaId) {
    return null;
  }

  const conta = await client.contaBancaria.findUnique({
    where: { id: Number(contaId) },
  });

  if (!conta) {
    throw new AppError(`Conta informada em ${fieldName} nao encontrada.`, 404);
  }

  return conta;
}

/**
 * Valida obrigatoriedades de conta por tipo de movimentacao.
 * @param {object} payload Dados de entrada.
 * @returns {void}
 */
function validateAccountsByType(payload) {
  const { tipo, contaOrigemId, contaDestinoId } = payload;

  if (tipo === MOVIMENTACAO_TIPO.ENTRADA && !contaDestinoId) {
    throw new AppError("Movimentacoes de entrada exigem contaDestinoId.", 400);
  }

  if (tipo === MOVIMENTACAO_TIPO.SAIDA && !contaOrigemId) {
    throw new AppError("Movimentacoes de saida exigem contaOrigemId.", 400);
  }

  if (tipo === MOVIMENTACAO_TIPO.TRANSFERENCIA) {
    if (!contaOrigemId || !contaDestinoId) {
      throw new AppError(
        "Transferencias exigem contaOrigemId e contaDestinoId.",
        400,
      );
    }

    if (Number(contaOrigemId) === Number(contaDestinoId)) {
      throw new AppError(
        "A conta de origem deve ser diferente da conta de destino.",
        400,
      );
    }
  }

  if (tipo === MOVIMENTACAO_TIPO.AJUSTE_SALDO) {
    if (!contaDestinoId) {
      throw new AppError(
        "Ajuste de saldo exige contaDestinoId (conta ajustada).",
        400,
      );
    }

    if (contaOrigemId) {
      throw new AppError("Ajuste de saldo nao permite contaOrigemId.", 400);
    }
  }
}

/**
 * Aplica restricoes de perfil CAIXA para operacoes de movimentacao.
 * @param {{ perfil?: string, contaBancariaId?: number | null } | undefined} user Usuario autenticado.
 * @param {object} payload Dados da movimentacao.
 */
function validateCaixaCreatePermissions(user, payload) {
  if (!user || user.perfil !== "CAIXA") {
    return;
  }

  if (!user.contaBancariaId) {
    throw new AppError(
      "Usuario CAIXA sem conta vinculada. Contate um administrador.",
      403,
    );
  }

  const contaVinculada = Number(user.contaBancariaId);
  const tipoPermitido =
    payload.tipo === MOVIMENTACAO_TIPO.ENTRADA ||
    payload.tipo === MOVIMENTACAO_TIPO.SAIDA;

  if (!tipoPermitido) {
    throw new AppError("Perfil CAIXA pode lancar apenas ENTRADA e SAIDA.", 403);
  }

  if (
    payload.tipo === MOVIMENTACAO_TIPO.ENTRADA &&
    Number(payload.contaDestinoId) !== contaVinculada
  ) {
    throw new AppError(
      "Perfil CAIXA pode lançar ENTRADA apenas na conta vinculada.",
      403,
    );
  }

  if (
    payload.tipo === MOVIMENTACAO_TIPO.SAIDA &&
    Number(payload.contaOrigemId) !== contaVinculada
  ) {
    throw new AppError(
      "Perfil CAIXA pode lançar SAIDA apenas na conta vinculada.",
      403,
    );
  }
}

/**
 * Restringe filtros e escopo de listagem para perfil CAIXA.
 * @param {{ perfil?: string, contaBancariaId?: number | null } | undefined} user Usuario autenticado.
 * @param {object} filters Filtros da listagem.
 * @returns {object}
 */
function applyCaixaListScope(user, filters) {
  if (!user || user.perfil !== "CAIXA") {
    return { ...filters };
  }

  if (!user.contaBancariaId) {
    throw new AppError(
      "Usuario CAIXA sem conta vinculada. Contate um administrador.",
      403,
    );
  }

  const scopedFilters = { ...filters };
  const contaVinculada = Number(user.contaBancariaId);

  if (
    scopedFilters.contaId &&
    Number(scopedFilters.contaId) !== contaVinculada
  ) {
    throw new AppError(
      "Perfil CAIXA pode consultar apenas a conta vinculada.",
      403,
    );
  }

  scopedFilters.contaId = contaVinculada;
  return scopedFilters;
}

/**
 * Normaliza payload de ajuste de saldo para valor assinado no banco.
 * @param {object} payload
 * @returns {object}
 */
function normalizePayload(payload) {
  if (payload.tipo !== MOVIMENTACAO_TIPO.AJUSTE_SALDO) {
    return payload;
  }

  const valorBase = Number(payload.valor);
  const operacao = String(payload.ajusteSaldoOperacao || "").toUpperCase();

  if (Number.isNaN(valorBase) || valorBase <= 0) {
    throw new AppError(
      "Ajuste de saldo exige valor numerico maior que zero.",
      400,
    );
  }

  if (!Object.values(AJUSTE_SALDO_OPERACAO).includes(operacao)) {
    throw new AppError(
      "Campo ajusteSaldoOperacao invalido para ajuste de saldo.",
      400,
    );
  }

  return {
    ...payload,
    valor:
      operacao === AJUSTE_SALDO_OPERACAO.SUBTRAIR
        ? -Math.abs(valorBase)
        : Math.abs(valorBase),
    categoria: "AJUSTE_SALDO",
    tipoDespesa: null,
    contaOrigemId: null,
  };
}

/**
 * Valida regras de negocio especificas por empresa.
 * @param {import("@prisma/client").Empresa} empresa Empresa relacionada.
 * @param {object} payload Dados da movimentacao.
 * @returns {Promise<void>}
 */
async function validateBusinessRules(empresa, payload, client = prisma) {
  const {
    projetoId,
    subcategoria,
    categoria,
    tipoDespesa,
    saasClienteId,
    saasLancamentoTipo,
    tipo,
  } = payload;
  const isAjusteSaldo = tipo === MOVIMENTACAO_TIPO.AJUSTE_SALDO;

  if (empresa.nome === "MaisQuiosque" && !projetoId && !isAjusteSaldo) {
    throw new AppError(
      "Movimentacoes da empresa MaisQuiosque exigem projetoId.",
      400,
    );
  }

  if (projetoId && !isAjusteSaldo) {
    const projeto = await client.projeto.findUnique({
      where: { id: Number(projetoId) },
    });

    if (!projeto) {
      throw new AppError("Projeto nao encontrado.", 404);
    }

    if (projeto.empresaId !== empresa.id) {
      throw new AppError(
        "O projeto informado nao pertence a empresa selecionada.",
        400,
      );
    }
  }

  if (empresa.nome === "GiraKids" && subcategoria && !isAjusteSaldo) {
    const allowed = ["TAKE_PARCERIA", "PELUCIA_PARCERIA", "OUTROS"];

    if (!allowed.includes(subcategoria)) {
      throw new AppError("Subcategoria invalida para GiraKids.", 400);
    }
  }

  if (empresa.nome !== "GiraKids" && subcategoria && !isAjusteSaldo) {
    throw new AppError(
      "Subcategoria so pode ser usada em movimentacoes da GiraKids.",
      400,
    );
  }

  if (isAjusteSaldo) {
    if (payload.status !== MovimentacaoStatus.REALIZADO) {
      throw new AppError("Ajuste de saldo deve ser REALIZADO.", 400);
    }

    if (categoria && categoria !== "AJUSTE_SALDO") {
      throw new AppError(
        "Ajuste de saldo deve usar categoria AJUSTE_SALDO.",
        400,
      );
    }

    if (tipoDespesa) {
      throw new AppError("Ajuste de saldo nao permite tipoDespesa.", 400);
    }

    if (subcategoria) {
      throw new AppError("Ajuste de saldo nao permite subcategoria.", 400);
    }

    if (projetoId) {
      throw new AppError("Ajuste de saldo nao permite projetoId.", 400);
    }
  }

  if (categoria === "CUSTO_FIXO") {
    if (!tipoDespesa) {
      throw new AppError(
        "Movimentacoes com CUSTO_FIXO exigem tipoDespesa.",
        400,
      );
    }

    if (!TIPOS_DESPESA_CUSTO_FIXO.includes(tipoDespesa)) {
      throw new AppError("tipoDespesa invalido para CUSTO_FIXO.", 400);
    }
  }

  if (categoria === "CUSTO_VARIAVEL") {
    if (!tipoDespesa) {
      throw new AppError(
        "Movimentacoes com CUSTO_VARIAVEL exigem tipoDespesa.",
        400,
      );
    }

    if (!TIPOS_DESPESA_CUSTO_VARIAVEL.includes(tipoDespesa)) {
      throw new AppError("tipoDespesa invalido para CUSTO_VARIAVEL.", 400);
    }
  }

  if (
    categoria !== "CUSTO_FIXO" &&
    categoria !== "CUSTO_VARIAVEL" &&
    tipoDespesa
  ) {
    throw new AppError(
      "tipoDespesa so pode ser usado com CUSTO_FIXO ou CUSTO_VARIAVEL.",
      400,
    );
  }

  const isSelfMachine = isSelfMachineEmpresa(empresa.nome);

  if (isSelfMachine) {
    if (saasClienteId && !saasLancamentoTipo) {
      throw new AppError(
        "Informe o tipo de lancamento ao selecionar cliente SaaS.",
        400,
      );
    }

    if (saasLancamentoTipo && !saasClienteId) {
      throw new AppError(
        "Informe o cliente SaaS ao selecionar tipo de lancamento.",
        400,
      );
    }

    if (
      saasLancamentoTipo &&
      !["MENSALIDADE", "PAGAMENTO"].includes(saasLancamentoTipo)
    ) {
      throw new AppError("Tipo de lancamento SelfMachine invalido.", 400);
    }

    if (saasClienteId) {
      const contrato = await client.saasCliente.findUnique({
        where: { id: Number(saasClienteId) },
        select: { id: true },
      });

      if (!contrato) {
        throw new AppError("Cliente SaaS informado nao encontrado.", 404);
      }
    }
  }

  if (!isSelfMachine && (saasClienteId || saasLancamentoTipo)) {
    throw new AppError(
      "Campos SelfMachine so podem ser usados quando a empresa selecionada for SelfMachine.",
      400,
    );
  }
}

/**
 * Aplica sincronizacao da mensalidade do cliente SaaS apos criar movimentacao.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {object} movimentacao
 * @param {string} nomeEmpresa
 * @returns {Promise<void>}
 */
async function syncSelfMachineFromMovimentacao(tx, movimentacao, nomeEmpresa) {
  if (!isSelfMachineEmpresa(nomeEmpresa)) {
    return;
  }

  if (!movimentacao.saasClienteId || !movimentacao.saasLancamentoTipo) {
    return;
  }

  if (movimentacao.saasLancamentoTipo !== "MENSALIDADE") {
    return;
  }

  if (movimentacao.status === MovimentacaoStatus.REALIZADO) {
    await selfMachineService.registerMensalidadePagamento(
      movimentacao.saasClienteId,
      new Date(movimentacao.data),
      tx,
    );
    return;
  }

  if (movimentacao.status === MovimentacaoStatus.PREVISTO) {
    await tx.saasCliente.update({
      where: { id: movimentacao.saasClienteId },
      data: {
        statusMensalidade: "EM_ABERTO",
        ultimoPedidoPagamentoAt: new Date(),
      },
    });
  }
}

/**
 * Aplica o impacto financeiro nas contas quando a movimentacao ja esta realizada.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx Cliente transacional.
 * @param {object} payload Dados da movimentacao.
 * @returns {Promise<void>}
 */
async function updateAccountBalances(tx, payload) {
  const { tipo, status, valor, contaOrigemId, contaDestinoId } = payload;

  if (status !== "REALIZADO") {
    return;
  }

  const decimalValue = toDecimal(valor);

  if (tipo === MOVIMENTACAO_TIPO.ENTRADA) {
    await tx.contaBancaria.update({
      where: { id: Number(contaDestinoId) },
      data: { saldoAtual: { increment: decimalValue } },
    });
  }

  if (tipo === MOVIMENTACAO_TIPO.SAIDA) {
    await tx.contaBancaria.update({
      where: { id: Number(contaOrigemId) },
      data: { saldoAtual: { decrement: decimalValue } },
    });
  }

  if (tipo === MOVIMENTACAO_TIPO.TRANSFERENCIA) {
    await tx.contaBancaria.update({
      where: { id: Number(contaOrigemId) },
      data: { saldoAtual: { decrement: decimalValue } },
    });

    await tx.contaBancaria.update({
      where: { id: Number(contaDestinoId) },
      data: { saldoAtual: { increment: decimalValue } },
    });
  }

  if (tipo === MOVIMENTACAO_TIPO.AJUSTE_SALDO) {
    const valorAjuste = Number(valor);
    const valorAjusteAbs = toDecimal(Math.abs(valorAjuste));

    await tx.contaBancaria.update({
      where: { id: Number(contaDestinoId) },
      data:
        valorAjuste >= 0
          ? { saldoAtual: { increment: valorAjusteAbs } }
          : { saldoAtual: { decrement: valorAjusteAbs } },
    });
  }
}

/**
 * Cria uma nova movimentacao aplicando validacoes de negocio e saldo.
 * @param {object} payload Dados recebidos na requisicao.
 * @returns {Promise<object>}
 */
async function createMovimentacao(payload, options = {}) {
  const client = options.tx || prisma;
  const normalizedPayload = normalizePayload(payload);
  validateCaixaCreatePermissions(options.user, normalizedPayload);
  validateAccountsByType(normalizedPayload);

  const empresa = await getEmpresaOrFail(normalizedPayload.empresaId, client);
  await validateBusinessRules(empresa, normalizedPayload, client);

  await Promise.all([
    getContaOrFail(normalizedPayload.contaOrigemId, "contaOrigemId", client),
    getContaOrFail(normalizedPayload.contaDestinoId, "contaDestinoId", client),
  ]);

  const createInClient = async (tx) => {
    const created = await tx.movimentacao.create({
      data: {
        data: new Date(normalizedPayload.data),
        valor: toDecimal(normalizedPayload.valor),
        tipo: normalizedPayload.tipo,
        categoria: normalizedPayload.categoria || null,
        tipoDespesa: normalizedPayload.tipoDespesa || null,
        canalOrigem: normalizedPayload.canalOrigem?.trim() || null,
        centroOperacao: normalizedPayload.centroOperacao?.trim() || null,
        referencia: normalizedPayload.referencia || null,
        status: normalizedPayload.status,
        subcategoria: normalizedPayload.subcategoria || null,
        empresaId: Number(normalizedPayload.empresaId),
        projetoId: normalizedPayload.projetoId
          ? Number(normalizedPayload.projetoId)
          : null,
        saasClienteId: normalizedPayload.saasClienteId
          ? Number(normalizedPayload.saasClienteId)
          : null,
        saasLancamentoTipo: normalizedPayload.saasLancamentoTipo || null,
        contaOrigemId: normalizedPayload.contaOrigemId
          ? Number(normalizedPayload.contaOrigemId)
          : null,
        contaDestinoId: normalizedPayload.contaDestinoId
          ? Number(normalizedPayload.contaDestinoId)
          : null,
      },
      include: {
        empresa: true,
        projeto: true,
        saasCliente: true,
        contaOrigem: true,
        contaDestino: true,
      },
    });

    await updateAccountBalances(tx, normalizedPayload);
    await syncSelfMachineFromMovimentacao(tx, created, empresa.nome);

    if (normalizedPayload.status === MovimentacaoStatus.PREVISTO) {
      const marker = `[AUTO_MOV_ID:${created.id}]`;
      await createAgendaFromPrevisto(tx, normalizedPayload, { marker });
    }

    return created;
  };

  const movimentacao = options.tx
    ? await createInClient(client)
    : await prisma.$transaction(createInClient);

  return movimentacao;
}

/**
 * Exclui movimentacao prevista e remove item de agenda gerado automaticamente.
 * @param {number | string} movimentacaoId Identificador da movimentacao.
 * @returns {Promise<{id: number}>}
 */
async function deleteMovimentacao(movimentacaoId) {
  return prisma.$transaction(async (tx) => {
    const movimentacao = await tx.movimentacao.findUnique({
      where: { id: Number(movimentacaoId) },
      select: {
        id: true,
        data: true,
        empresaId: true,
        tipo: true,
        valor: true,
        status: true,
        saasClienteId: true,
        saasLancamentoTipo: true,
        contaOrigemId: true,
        contaDestinoId: true,
      },
    });

    if (!movimentacao) {
      throw new AppError("Movimentacao nao encontrada.", 404);
    }

    if (movimentacao.status === MovimentacaoStatus.PREVISTO) {
      await deleteAutoAgendaForMovimentacao(tx, movimentacao.id);
    }

    // Estorna o efeito financeiro para deixar o saldo como se o lançamento nunca existisse.
    if (movimentacao.status === MovimentacaoStatus.REALIZADO) {
      if (
        movimentacao.tipo === MOVIMENTACAO_TIPO.ENTRADA &&
        movimentacao.contaDestinoId
      ) {
        await tx.contaBancaria.update({
          where: { id: movimentacao.contaDestinoId },
          data: {
            saldoAtual: {
              decrement: movimentacao.valor,
            },
          },
        });
      }

      if (
        movimentacao.tipo === MOVIMENTACAO_TIPO.SAIDA &&
        movimentacao.contaOrigemId
      ) {
        await tx.contaBancaria.update({
          where: { id: movimentacao.contaOrigemId },
          data: {
            saldoAtual: {
              increment: movimentacao.valor,
            },
          },
        });
      }

      if (movimentacao.tipo === MOVIMENTACAO_TIPO.TRANSFERENCIA) {
        if (movimentacao.contaOrigemId) {
          await tx.contaBancaria.update({
            where: { id: movimentacao.contaOrigemId },
            data: {
              saldoAtual: {
                increment: movimentacao.valor,
              },
            },
          });
        }

        if (movimentacao.contaDestinoId) {
          await tx.contaBancaria.update({
            where: { id: movimentacao.contaDestinoId },
            data: {
              saldoAtual: {
                decrement: movimentacao.valor,
              },
            },
          });
        }
      }

      if (
        movimentacao.tipo === MOVIMENTACAO_TIPO.AJUSTE_SALDO &&
        movimentacao.contaDestinoId
      ) {
        const valorAjuste = new Prisma.Decimal(movimentacao.valor);

        await tx.contaBancaria.update({
          where: { id: movimentacao.contaDestinoId },
          data: valorAjuste.gte(0)
            ? {
                saldoAtual: {
                  decrement: valorAjuste,
                },
              }
            : {
                saldoAtual: {
                  increment: valorAjuste.abs(),
                },
              },
        });
      }
    }

    await tx.movimentacao.delete({ where: { id: movimentacao.id } });

    if (
      movimentacao.saasClienteId &&
      movimentacao.saasLancamentoTipo === "MENSALIDADE"
    ) {
      if (movimentacao.status === MovimentacaoStatus.REALIZADO) {
        const { start, end } = monthRange(new Date(movimentacao.data));

        const ultimoPagamentoMes = await tx.movimentacao.findFirst({
          where: {
            saasClienteId: movimentacao.saasClienteId,
            saasLancamentoTipo: "MENSALIDADE",
            status: MovimentacaoStatus.REALIZADO,
            data: {
              gte: start,
              lte: end,
            },
          },
          orderBy: [{ data: "desc" }, { createdAt: "desc" }],
          select: { data: true },
        });

        if (ultimoPagamentoMes) {
          await selfMachineService.registerMensalidadePagamento(
            movimentacao.saasClienteId,
            new Date(ultimoPagamentoMes.data),
            tx,
          );
        } else {
          await tx.saasCliente.update({
            where: { id: movimentacao.saasClienteId },
            data: { ultimaMensalidadePagaEm: null },
          });

          await selfMachineService.recomputeContratoMensalidadeStatus(
            movimentacao.saasClienteId,
            tx,
          );
        }
      } else {
        await selfMachineService.recomputeContratoMensalidadeStatus(
          movimentacao.saasClienteId,
          tx,
        );
      }
    }

    return {
      id: movimentacao.id,
      statusRemovido: movimentacao.status,
      saldoEstornado: movimentacao.status === MovimentacaoStatus.REALIZADO,
    };
  });
}

/**
 * Lista movimentacoes com filtros e paginacao.
 * @param {{ empresaId?: string | number, contaId?: string | number, categoria?: string, tipoDespesa?: string, referencia?: string, tipo?: string, status?: string, canalOrigem?: string, centroOperacao?: string, dataInicio?: string, dataFim?: string, page?: string | number, limit?: string | number }} filters Filtros opcionais.
 * @returns {Promise<{ items: object[], pagination: { page: number, limit: number, total: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean } }>}
 */
async function listMovimentacoes(filters, options = {}) {
  const scopedFilters = applyCaixaListScope(options.user, filters);
  const page = Math.max(1, Number(scopedFilters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(scopedFilters.limit) || 20));

  const dateFilter = {};
  if (scopedFilters.dataInicio) {
    dateFilter.gte = new Date(scopedFilters.dataInicio);
  }

  if (scopedFilters.dataFim) {
    const endDate = new Date(scopedFilters.dataFim);
    endDate.setHours(23, 59, 59, 999);
    dateFilter.lte = endDate;
  }

  const where = {
    ...(scopedFilters.empresaId
      ? { empresaId: Number(scopedFilters.empresaId) }
      : {}),
    ...(scopedFilters.categoria ? { categoria: scopedFilters.categoria } : {}),
    ...(scopedFilters.tipoDespesa
      ? { tipoDespesa: scopedFilters.tipoDespesa }
      : {}),
    ...(scopedFilters.tipo ? { tipo: scopedFilters.tipo } : {}),
    ...(scopedFilters.status ? { status: scopedFilters.status } : {}),
    ...(scopedFilters.canalOrigem
      ? {
          canalOrigem: {
            contains: scopedFilters.canalOrigem,
            mode: "insensitive",
          },
        }
      : {}),
    ...(scopedFilters.centroOperacao
      ? {
          centroOperacao: {
            contains: scopedFilters.centroOperacao,
            mode: "insensitive",
          },
        }
      : {}),
    ...(scopedFilters.referencia
      ? {
          referencia: {
            contains: scopedFilters.referencia,
            mode: "insensitive",
          },
        }
      : {}),
    ...(Object.keys(dateFilter).length ? { data: dateFilter } : {}),
    ...(scopedFilters.contaId
      ? {
          OR: [
            { contaOrigemId: Number(scopedFilters.contaId) },
            { contaDestinoId: Number(scopedFilters.contaId) },
          ],
        }
      : {}),
    ...(String(scopedFilters.somenteAprovadosConciliacao).toLowerCase() ===
    "true"
      ? {
          AND: [
            {
              OR: [
                {
                  canalOrigem: {
                    not: "AGARRAMAIS",
                  },
                },
                {
                  AND: [
                    { canalOrigem: "AGARRAMAIS" },
                    {
                      referencia: {
                        startsWith: "Aprovado via AgarraMais -",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.movimentacao.count({ where }),
    prisma.movimentacao.findMany({
      where,
      include: {
        empresa: {
          select: {
            id: true,
            nome: true,
          },
        },
        projeto: {
          select: {
            id: true,
            nome: true,
          },
        },
        saasCliente: {
          select: {
            id: true,
            nomeCliente: true,
            nomeSistema: true,
          },
        },
        contaOrigem: {
          select: {
            id: true,
            nome: true,
            banco: true,
          },
        },
        contaDestino: {
          select: {
            id: true,
            nome: true,
            banco: true,
          },
        },
      },
      orderBy: [{ data: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = {
  createMovimentacao,
  deleteMovimentacao,
  listMovimentacoes,
};

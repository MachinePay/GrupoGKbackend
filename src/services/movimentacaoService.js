const {
  AgendaStatus,
  AgendaTipo,
  Prisma,
  MovimentacaoStatus,
  MovimentacaoTipo,
} = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

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
 * Cria item de agenda automaticamente para movimentacoes previstas.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx Cliente transacional.
 * @param {object} payload Dados recebidos da movimentacao.
 * @returns {Promise<void>}
 */
async function createAgendaFromPrevisto(tx, payload, options = {}) {
  const isPrevisto = payload.status === MovimentacaoStatus.PREVISTO;
  const isSupportedType =
    payload.tipo === MovimentacaoTipo.ENTRADA ||
    payload.tipo === MovimentacaoTipo.SAIDA;

  if (!isPrevisto || !isSupportedType) {
    return;
  }

  const agendaTipo =
    payload.tipo === MovimentacaoTipo.SAIDA
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

  if (tipo === MovimentacaoTipo.ENTRADA && !contaDestinoId) {
    throw new AppError("Movimentacoes de entrada exigem contaDestinoId.", 400);
  }

  if (tipo === MovimentacaoTipo.SAIDA && !contaOrigemId) {
    throw new AppError("Movimentacoes de saida exigem contaOrigemId.", 400);
  }

  if (tipo === MovimentacaoTipo.TRANSFERENCIA) {
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
}

/**
 * Valida regras de negocio especificas por empresa.
 * @param {import("@prisma/client").Empresa} empresa Empresa relacionada.
 * @param {object} payload Dados da movimentacao.
 * @returns {Promise<void>}
 */
async function validateBusinessRules(empresa, payload, client = prisma) {
  const { projetoId, subcategoria, categoria, tipoDespesa } = payload;

  if (empresa.nome === "MaisQuiosque" && !projetoId) {
    throw new AppError(
      "Movimentacoes da empresa MaisQuiosque exigem projetoId.",
      400,
    );
  }

  if (projetoId) {
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

  if (empresa.nome === "GiraKids" && subcategoria) {
    const allowed = ["TAKE_PARCERIA", "PELUCIA_PARCERIA", "OUTROS"];

    if (!allowed.includes(subcategoria)) {
      throw new AppError("Subcategoria invalida para GiraKids.", 400);
    }
  }

  if (empresa.nome !== "GiraKids" && subcategoria) {
    throw new AppError(
      "Subcategoria so pode ser usada em movimentacoes da GiraKids.",
      400,
    );
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

  if (tipo === MovimentacaoTipo.ENTRADA) {
    await tx.contaBancaria.update({
      where: { id: Number(contaDestinoId) },
      data: { saldoAtual: { increment: decimalValue } },
    });
  }

  if (tipo === MovimentacaoTipo.SAIDA) {
    await tx.contaBancaria.update({
      where: { id: Number(contaOrigemId) },
      data: { saldoAtual: { decrement: decimalValue } },
    });
  }

  if (tipo === MovimentacaoTipo.TRANSFERENCIA) {
    await tx.contaBancaria.update({
      where: { id: Number(contaOrigemId) },
      data: { saldoAtual: { decrement: decimalValue } },
    });

    await tx.contaBancaria.update({
      where: { id: Number(contaDestinoId) },
      data: { saldoAtual: { increment: decimalValue } },
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
  validateAccountsByType(payload);

  const empresa = await getEmpresaOrFail(payload.empresaId, client);
  await validateBusinessRules(empresa, payload, client);

  await Promise.all([
    getContaOrFail(payload.contaOrigemId, "contaOrigemId", client),
    getContaOrFail(payload.contaDestinoId, "contaDestinoId", client),
  ]);

  const createInClient = async (tx) => {
    const created = await tx.movimentacao.create({
      data: {
        data: new Date(payload.data),
        valor: toDecimal(payload.valor),
        tipo: payload.tipo,
        categoria: payload.categoria || null,
        tipoDespesa: payload.tipoDespesa || null,
        canalOrigem: payload.canalOrigem?.trim() || null,
        centroOperacao: payload.centroOperacao?.trim() || null,
        referencia: payload.referencia || null,
        status: payload.status,
        subcategoria: payload.subcategoria || null,
        empresaId: Number(payload.empresaId),
        projetoId: payload.projetoId ? Number(payload.projetoId) : null,
        contaOrigemId: payload.contaOrigemId
          ? Number(payload.contaOrigemId)
          : null,
        contaDestinoId: payload.contaDestinoId
          ? Number(payload.contaDestinoId)
          : null,
      },
      include: {
        empresa: true,
        projeto: true,
        contaOrigem: true,
        contaDestino: true,
      },
    });

    await updateAccountBalances(tx, payload);

    if (payload.status === MovimentacaoStatus.PREVISTO) {
      const marker = `[AUTO_MOV_ID:${created.id}]`;
      await createAgendaFromPrevisto(tx, payload, { marker });
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
        status: true,
      },
    });

    if (!movimentacao) {
      throw new AppError("Movimentacao nao encontrada.", 404);
    }

    if (movimentacao.status !== MovimentacaoStatus.PREVISTO) {
      throw new AppError(
        "Apenas movimentacoes previstas podem ser excluidas.",
        400,
      );
    }

    await deleteAutoAgendaForMovimentacao(tx, movimentacao.id);
    await tx.movimentacao.delete({ where: { id: movimentacao.id } });

    return { id: movimentacao.id };
  });
}

/**
 * Lista movimentacoes com filtros e paginacao.
 * @param {{ empresaId?: string | number, contaId?: string | number, categoria?: string, tipoDespesa?: string, referencia?: string, tipo?: string, status?: string, canalOrigem?: string, centroOperacao?: string, dataInicio?: string, dataFim?: string, page?: string | number, limit?: string | number }} filters Filtros opcionais.
 * @returns {Promise<{ items: object[], pagination: { page: number, limit: number, total: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean } }>}
 */
async function listMovimentacoes(filters) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

  const dateFilter = {};
  if (filters.dataInicio) {
    dateFilter.gte = new Date(filters.dataInicio);
  }

  if (filters.dataFim) {
    const endDate = new Date(filters.dataFim);
    endDate.setHours(23, 59, 59, 999);
    dateFilter.lte = endDate;
  }

  const where = {
    ...(filters.empresaId ? { empresaId: Number(filters.empresaId) } : {}),
    ...(filters.categoria ? { categoria: filters.categoria } : {}),
    ...(filters.tipoDespesa ? { tipoDespesa: filters.tipoDespesa } : {}),
    ...(filters.tipo ? { tipo: filters.tipo } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.canalOrigem
      ? {
          canalOrigem: {
            contains: filters.canalOrigem,
            mode: "insensitive",
          },
        }
      : {}),
    ...(filters.centroOperacao
      ? {
          centroOperacao: {
            contains: filters.centroOperacao,
            mode: "insensitive",
          },
        }
      : {}),
    ...(filters.referencia
      ? {
          referencia: {
            contains: filters.referencia,
            mode: "insensitive",
          },
        }
      : {}),
    ...(Object.keys(dateFilter).length ? { data: dateFilter } : {}),
    ...(filters.contaId
      ? {
          OR: [
            { contaOrigemId: Number(filters.contaId) },
            { contaDestinoId: Number(filters.contaId) },
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

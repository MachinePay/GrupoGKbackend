const {
  Prisma,
  MovimentacaoTipo,
  MovimentacaoStatus,
  MovimentacaoCategoria,
  TipoDespesa,
  AgendaTipo,
  AgendaStatus,
} = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

const AGARRAMAIS_SOURCE = "AGARRAMAIS_GASTO_FIXO";
const AGARRAMAIS_REPORT_SOURCE = "AGARRAMAIS_RELATORIO";
const DEFAULT_REPORT_DAYS = 30;

function getAgarraMaisConfig() {
  const apiUrl = process.env.AGARRAMAIS_API_URL;
  const email = process.env.AGARRAMAIS_EMAIL;
  const senha = process.env.AGARRAMAIS_SENHA;

  if (!apiUrl || !email || !senha) {
    throw new AppError(
      "Configure AGARRAMAIS_API_URL, AGARRAMAIS_EMAIL e AGARRAMAIS_SENHA para usar a integracao.",
      500,
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    email,
    senha,
    timeoutMs: Number(process.env.AGARRAMAIS_TIMEOUT_MS || 15000),
    lojaIdsPadrao: process.env.AGARRAMAIS_LOJA_IDS
      ? process.env.AGARRAMAIS_LOJA_IDS.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
  };
}

function getPeriodoReferencia(dataInicio, dataFim) {
  const fim = dataFim ? new Date(`${dataFim}T23:59:59`) : new Date();
  const inicio = dataInicio
    ? new Date(`${dataInicio}T00:00:00`)
    : new Date(new Date(fim).setDate(fim.getDate() - DEFAULT_REPORT_DAYS));

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw new AppError("Periodo da integracao invalido.", 400);
  }

  return {
    inicio,
    fim,
    dataInicioIso: inicio.toISOString().slice(0, 10),
    dataFimIso: fim.toISOString().slice(0, 10),
    competencia: `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}`,
  };
}

async function requestAgarraMais(
  path,
  { method = "GET", token, body, params, timeoutMs },
) {
  const config = getAgarraMaisConfig();
  const url = new URL(`${config.apiUrl}${path}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs || config.timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ||
        payload?.error ||
        payload?.message ||
        `Falha na API AgarraMais (${response.status}).`,
      502,
    );
  }

  return payload;
}

async function authenticateAgarraMais() {
  const config = getAgarraMaisConfig();
  const response = await requestAgarraMais("/api/auth/login", {
    method: "POST",
    body: {
      email: config.email,
      senha: config.senha,
    },
  });

  if (!response?.token) {
    throw new AppError(
      "A API AgarraMais nao retornou token de autenticacao.",
      502,
    );
  }

  return response.token;
}

function normalizarNomeDespesa(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapCategoria(nomeDespesa) {
  const nome = normalizarNomeDespesa(nomeDespesa);

  if (!nome) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
    };
  }

  if (nome.includes("ALUGUEL") || nome.includes("CONDOMINIO")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.DESPESAS_ADMINISTRATIVAS,
    };
  }

  if (
    nome.includes("FOLHA") ||
    nome.includes("SALARIO") ||
    nome.includes("FUNCIONARIO")
  ) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.FOLHA_PAGAMENTO,
    };
  }

  if (nome.includes("SOCIO")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.RETIRADA_SOCIOS,
    };
  }

  if (
    nome.includes("ENERG") ||
    nome.includes("LUZ") ||
    nome.includes("AGUA") ||
    nome.includes("INTERNET")
  ) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
    };
  }

  return {
    categoria: MovimentacaoCategoria.CUSTO_FIXO,
    tipoDespesa: TipoDespesa.DESPESAS_DIVERSAS,
  };
}

function construirDescricaoRelatorio(loja, dashboard) {
  const totais = dashboard?.totais || {};
  return [
    `Loja: ${loja.nome}`,
    `Faturamento: ${Number(totais.faturamento || 0).toFixed(2)}`,
    `Gasto fixo periodo: ${Number(totais.totalGastosFixos || 0).toFixed(2)}`,
    `Gasto variavel periodo: ${Number(totais.totalGastosVariaveis || 0).toFixed(2)}`,
    `Lucro operacional: ${Number(totais.lucroOperacional || 0).toFixed(2)}`,
  ].join(" | ");
}

/**
 * Busca gastos fixos e snapshots de relatorio na API AgarraMais.
 * @param {object} options Opcoes de sincronizacao.
 * @returns {Promise<Array<object>>}
 */
async function fetchAgarraMaisAPI(options = {}) {
  const token = await authenticateAgarraMais();
  const periodo = getPeriodoReferencia(options.dataInicio, options.dataFim);
  const lojasSelecionadas = new Set(
    (options.lojaIds?.length
      ? options.lojaIds
      : getAgarraMaisConfig().lojaIdsPadrao
    ).map(String),
  );

  const lojas = await requestAgarraMais("/api/lojas", { token });
  const lojasFiltradas = Array.isArray(lojas)
    ? lojas.filter(
        (loja) =>
          !lojasSelecionadas.size || lojasSelecionadas.has(String(loja.id)),
      )
    : [];

  const itens = [];

  for (const loja of lojasFiltradas) {
    const gastos = await requestAgarraMais(
      `/api/gastos-fixos-loja/${loja.id}`,
      { token },
    );

    for (const gasto of Array.isArray(gastos) ? gastos : []) {
      const classificacao = mapCategoria(gasto.nome);
      itens.push({
        id: `gasto-fixo:${loja.id}:${gasto.id}:${periodo.competencia}`,
        descricao: `${gasto.nome} - ${loja.nome}`,
        detalhe: gasto.observacao || null,
        valor: Number(gasto.valor || 0),
        data: new Date(`${periodo.dataFimIso}T12:00:00`),
        tipo: "GASTO_FIXO",
        categoria: classificacao.categoria,
        tipoDespesa: classificacao.tipoDespesa,
        lojaId: loja.id,
        lojaNome: loja.nome,
        origem: AGARRAMAIS_SOURCE,
      });
    }

    try {
      const dashboard = await requestAgarraMais("/api/relatorios/dashboard", {
        token,
        params: {
          lojaId: loja.id,
          dataInicio: periodo.dataInicioIso,
          dataFim: periodo.dataFimIso,
        },
      });

      itens.push({
        id: `relatorio:${loja.id}:${periodo.dataInicioIso}:${periodo.dataFimIso}`,
        descricao: `Relatorio operacional - ${loja.nome}`,
        detalhe: construirDescricaoRelatorio(loja, dashboard),
        valor: 0,
        data: new Date(`${periodo.dataFimIso}T12:00:00`),
        tipo: "RELATORIO",
        categoria: null,
        tipoDespesa: null,
        lojaId: loja.id,
        lojaNome: loja.nome,
        origem: AGARRAMAIS_REPORT_SOURCE,
      });
    } catch (error) {
      itens.push({
        id: `relatorio-erro:${loja.id}:${periodo.dataInicioIso}:${periodo.dataFimIso}`,
        descricao: `Relatorio indisponivel - ${loja.nome}`,
        detalhe: `Nao foi possivel obter o dashboard da AgarraMais: ${error.message}`,
        valor: 0,
        data: new Date(`${periodo.dataFimIso}T12:00:00`),
        tipo: "RELATORIO",
        categoria: null,
        tipoDespesa: null,
        lojaId: loja.id,
        lojaNome: loja.nome,
        origem: AGARRAMAIS_REPORT_SOURCE,
      });
    }
  }

  return itens;
}

/**
 * Sincroniza dados da AgarraMais com o sistema, criando itens de agenda pendentes.
 * @param {number} empresaId ID da empresa para importar dados
 * @param {number} usuarioId ID do usuário que dispara a sincronização (auditoria)
 * @returns {Promise<{sincronizados: number, duplicados: number, detalhes: Array}>}
 */
async function syncAgarraMais(empresaId, usuarioId, options = {}) {
  try {
    const dadosExternos = await fetchAgarraMaisAPI(options);

    if (!dadosExternos || dadosExternos.length === 0) {
      return {
        sincronizados: 0,
        duplicados: 0,
        detalhes: [
          { status: "info", mensagem: "Nenhum dado novo na AgarraMais" },
        ],
      };
    }

    const resultado = {
      sincronizados: 0,
      duplicados: 0,
      erros: 0,
      detalhes: [],
    };

    // Processa cada item externo
    for (const item of dadosExternos) {
      try {
        const jaExiste = await prisma.agenda.findFirst({
          where: {
            referenciaExternaId: item.id,
            empresaId,
          },
        });

        if (jaExiste) {
          resultado.duplicados += 1;
          resultado.detalhes.push({
            status: "duplicado",
            mensagem: `Item ${item.descricao} já foi importado anteriormente`,
            referenciaExterna: item.id,
          });
          continue;
        }

        const agendaCriada = await prisma.agenda.create({
          data: {
            data: item.data,
            titulo: item.descricao,
            descricao: [
              `Importado automaticamente da AgarraMais`,
              item.lojaNome ? `Loja: ${item.lojaNome}` : null,
              item.detalhe,
            ]
              .filter(Boolean)
              .join(" | "),
            valor: new Prisma.Decimal(item.valor),
            prioridade: "ALTA",
            status: AgendaStatus.PENDENTE_INTEGRACAO,
            tipo:
              item.tipo === "GASTO_FIXO"
                ? AgendaTipo.PAGAR
                : AgendaTipo.RECEBER,
            origemExterna: true,
            referenciaExternaId: item.id,
            origem: item.origem,
            empresaId,
          },
        });

        resultado.sincronizados += 1;
        resultado.detalhes.push({
          status: "sucesso",
          mensagem: `Item ${item.descricao} importado com sucesso`,
          agendaId: agendaCriada.id,
          referenciaExterna: item.id,
        });
      } catch (erro) {
        resultado.erros += 1;
        resultado.detalhes.push({
          status: "erro",
          mensagem: `Erro ao importar ${item.descricao}: ${erro.message}`,
          referenciaExterna: item.id,
        });
      }
    }

    return resultado;
  } catch (erro) {
    throw new AppError(
      `Erro ao sincronizar com AgarraMais: ${erro.message}`,
      500,
    );
  }
}

/**
 * Aprova um item pendente da integração e o converte em movimentação real.
 * @param {number} agendaId ID do item de agenda a aprovar
 * @param {number} usuarioId ID do usuário aprovador
 * @param {object} opcoes Opções adicionais para ajustes
 * @returns {Promise<{agendaId: number, movimentacaoId: number}>}
 */
async function aprovarPendencia(agendaId, usuarioId, opcoes = {}) {
  try {
    const item = await prisma.agenda.findUnique({
      where: { id: agendaId },
      include: { empresa: true },
    });

    if (!item) {
      throw new AppError("Item de agenda não encontrado", 404);
    }

    if (!item.origemExterna) {
      throw new AppError("Apenas itens da integração podem ser aprovados", 400);
    }

    if (!item.referenciaExternaId) {
      throw new AppError("Item não possui referência externa válida", 400);
    }

    const valorFinal = opcoes.valorAjustado
      ? new Prisma.Decimal(opcoes.valorAjustado)
      : item.valor;
    const classificacaoPadrao = mapCategoria(item.titulo);
    const categoriaFinal =
      opcoes.categoriaAjustada || classificacaoPadrao.categoria;
    const tipoDespesaFinal =
      opcoes.tipoDespesaAjustada || classificacaoPadrao.tipoDespesa;

    if (item.origem === AGARRAMAIS_REPORT_SOURCE) {
      await prisma.agenda.update({
        where: { id: agendaId },
        data: {
          status: AgendaStatus.REALIZADO,
          usuarioAprovadorId: usuarioId,
          dataAprovacao: new Date(),
        },
      });

      return { agendaId, movimentacaoId: null, revisado: true };
    }

    let contaOrigemId = null;
    let contaDestinoId = null;

    if (item.tipo === AgendaTipo.PAGAR) {
      // Para pagamentos, precisa da conta origem
      contaOrigemId = opcoes.contaId || null;
    } else {
      // Para recebimentos, conta destino
      contaDestinoId = opcoes.contaId || null;
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const movimentacao = await tx.movimentacao.create({
        data: {
          data: new Date(item.data),
          valor: valorFinal,
          tipo:
            item.tipo === AgendaTipo.PAGAR
              ? MovimentacaoTipo.SAIDA
              : MovimentacaoTipo.ENTRADA,
          categoria: categoriaFinal,
          tipoDespesa: item.tipo === AgendaTipo.PAGAR ? tipoDespesaFinal : null,
          referencia: `Aprovado via AgarraMais - ${item.referenciaExternaId}`,
          status: MovimentacaoStatus.REALIZADO,
          canalOrigem: "AGARRAMAIS",
          empresaId: item.empresaId,
          contaOrigemId,
          contaDestinoId,
        },
      });

      if (contaOrigemId) {
        await tx.contaBancaria.update({
          where: { id: contaOrigemId },
          data: {
            saldoAtual: {
              decrement: valorFinal,
            },
          },
        });
      } else if (contaDestinoId) {
        await tx.contaBancaria.update({
          where: { id: contaDestinoId },
          data: {
            saldoAtual: {
              increment: valorFinal,
            },
          },
        });
      }

      await tx.agenda.update({
        where: { id: agendaId },
        data: {
          status: AgendaStatus.REALIZADO,
          usuarioAprovadorId: usuarioId,
          dataAprovacao: new Date(),
        },
      });

      return { agendaId, movimentacaoId: movimentacao.id };
    });

    return resultado;
  } catch (erro) {
    if (erro instanceof AppError) {
      throw erro;
    }
    throw new AppError(`Erro ao aprovar pendência: ${erro.message}`, 500);
  }
}

/**
 * Rejeita um item pendente da integração (deleta sem criar movimentação).
 * @param {number} agendaId ID do item de agenda
 * @param {string} motivo Motivo da rejeição para auditoria
 * @returns {Promise<void>}
 */
async function rejeitarPendencia(agendaId, motivo) {
  try {
    const item = await prisma.agenda.findUnique({
      where: { id: agendaId },
    });

    if (!item) {
      throw new AppError("Item de agenda não encontrado", 404);
    }

    if (!item.origemExterna) {
      throw new AppError(
        "Apenas itens da integração podem ser rejeitados",
        400,
      );
    }

    await prisma.agenda.update({
      where: { id: agendaId },
      data: {
        status: AgendaStatus.ATRASADO,
        descricao: `[REJEITADO] ${item.descricao}. Motivo: ${motivo}`,
      },
    });
  } catch (erro) {
    if (erro instanceof AppError) {
      throw erro;
    }
    throw new AppError(`Erro ao rejeitar pendência: ${erro.message}`, 500);
  }
}

/**
 * Lista todos os itens pendentes de integração de uma empresa.
 * @param {number} empresaId ID da empresa
 * @returns {Promise<Array<object>>}
 */
async function listarPendencias(empresaId) {
  try {
    const pendencias = await prisma.agenda.findMany({
      where: {
        empresaId,
        origemExterna: true,
        status: AgendaStatus.PENDENTE_INTEGRACAO,
      },
      include: {
        empresa: { select: { id: true, nome: true } },
      },
      orderBy: { data: "asc" },
    });

    return pendencias.map((item) => ({
      ...item,
      classificacaoExterna:
        item.origem === AGARRAMAIS_REPORT_SOURCE ? "RELATORIO" : "GASTO_FIXO",
      permiteAprovacaoFinanceira: item.origem !== AGARRAMAIS_REPORT_SOURCE,
    }));
  } catch (erro) {
    throw new AppError(`Erro ao listar pendências: ${erro.message}`, 500);
  }
}

/**
 * Obtém estatísticas de pendências de um dia ou período.
 * @param {number} empresaId ID da empresa
 * @param {Date} dataInicio Data início
 * @param {Date} dataFim Data fim
 * @returns {Promise<{totalPendentes: number, valorTotal: Decimal, porStatus: object}>}
 */
async function obterEstatisticasPendencias(empresaId, dataInicio, dataFim) {
  try {
    const pendencias = await prisma.agenda.findMany({
      where: {
        empresaId,
        origemExterna: true,
        data: { gte: dataInicio, lte: dataFim },
      },
      select: { status: true, valor: true },
    });

    const totalPendentes = pendencias.length;
    const valorTotal = pendencias.reduce(
      (sum, p) => sum.plus(p.valor),
      new Prisma.Decimal(0),
    );

    const porStatus = {};
    pendencias.forEach((p) => {
      porStatus[p.status] = (porStatus[p.status] || 0) + 1;
    });

    return {
      totalPendentes,
      valorTotal: valorTotal.toNumber(),
      porStatus,
    };
  } catch (erro) {
    throw new AppError(`Erro ao obter estatísticas: ${erro.message}`, 500);
  }
}

module.exports = {
  fetchAgarraMaisAPI,
  syncAgarraMais,
  aprovarPendencia,
  rejeitarPendencia,
  listarPendencias,
  obterEstatisticasPendencias,
};

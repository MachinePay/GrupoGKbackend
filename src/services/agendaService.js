const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const { createMovimentacao } = require("./movimentacaoService");

/**
 * Converte valores para Decimal do Prisma.
 * @param {number | string} value Valor bruto.
 * @returns {Prisma.Decimal}
 */
function toDecimal(value) {
  return new Prisma.Decimal(value);
}

/**
 * Monta o filtro de periodo da agenda.
 * @param {string | undefined} dataInicio Data inicial opcional.
 * @param {string | undefined} dataFim Data final opcional.
 * @returns {object}
 */
function buildAgendaDateFilter(dataInicio, dataFim) {
  if (!dataInicio && !dataFim) {
    return {};
  }

  const dateFilter = {};

  if (dataInicio) {
    dateFilter.gte = new Date(dataInicio);
  }

  if (dataFim) {
    dateFilter.lte = new Date(dataFim);
  }

  return { data: dateFilter };
}

/**
 * Lista os itens da agenda com filtros opcionais por periodo.
 * @param {{ dataInicio?: string, dataFim?: string, status?: string, tipo?: string }} filters Filtros da consulta.
 * @returns {Promise<object[]>}
 */
async function getAgendaItems(filters) {
  const where = {
    ...buildAgendaDateFilter(filters.dataInicio, filters.dataFim),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.tipo ? { tipo: filters.tipo } : {}),
    ...(filters.empresaId ? { empresaId: Number(filters.empresaId) } : {}),
  };

  return prisma.agenda.findMany({
    where,
    include: {
      empresa: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
    orderBy: [{ data: "asc" }, { prioridade: "asc" }],
  });
}

/**
 * Lista historico de itens baixados da agenda.
 * @param {{ dataInicio?: string, dataFim?: string, empresaId?: number | string, limit?: number | string, page?: number | string }} filters Filtros da consulta.
 * @returns {Promise<{ items: object[], pagination: { page: number, limit: number, total: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean } }>}
 */
async function getAgendaSettlementHistory(filters) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

  const where = {
    ...buildAgendaDateFilter(filters.dataInicio, filters.dataFim),
    status: "REALIZADO",
    ...(filters.empresaId ? { empresaId: Number(filters.empresaId) } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.agenda.count({ where }),
    prisma.agenda.findMany({
      where,
      include: {
        empresa: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { data: "desc" }],
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

/**
 * Cria um item de agenda para pagar/receber.
 * @param {{ data: string, titulo: string, descricao?: string, valor: number | string, prioridade: string, status: string, tipo: string, empresaId: number }} payload Dados do item.
 * @returns {Promise<object>}
 */
async function createAgendaItem(payload) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: Number(payload.empresaId) },
  });

  if (!empresa) {
    throw new AppError("Empresa nao encontrada para vincular agenda.", 404);
  }

  return prisma.agenda.create({
    data: {
      data: new Date(payload.data),
      titulo: payload.titulo.trim(),
      descricao: payload.descricao?.trim() || null,
      origem: payload.origem?.trim() || null,
      valor: toDecimal(payload.valor),
      prioridade: payload.prioridade.trim(),
      status: payload.status,
      tipo: payload.tipo,
      empresaId: Number(payload.empresaId),
    },
    include: {
      empresa: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
  });
}

/**
 * Atualiza um item da agenda antes da baixa.
 * @param {number | string} agendaId Identificador do item.
 * @param {{ data: string, titulo: string, descricao?: string, valor: number | string, prioridade: string, status: string, tipo: string, empresaId: number }} payload Dados do item.
 * @returns {Promise<object>}
 */
async function updateAgendaItem(agendaId, payload) {
  const [agenda, empresa] = await Promise.all([
    prisma.agenda.findUnique({ where: { id: Number(agendaId) } }),
    prisma.empresa.findUnique({ where: { id: Number(payload.empresaId) } }),
  ]);

  if (!agenda) {
    throw new AppError("Item de agenda nao encontrado.", 404);
  }

  if (agenda.status === "REALIZADO") {
    throw new AppError(
      "Nao e possivel editar um item de agenda ja realizado.",
      400,
    );
  }

  if (!empresa) {
    throw new AppError("Empresa nao encontrada para vincular agenda.", 404);
  }

  return prisma.agenda.update({
    where: { id: Number(agendaId) },
    data: {
      data: new Date(payload.data),
      titulo: payload.titulo.trim(),
      descricao: payload.descricao?.trim() || null,
      origem: payload.origem?.trim() || null,
      valor: toDecimal(payload.valor),
      prioridade: payload.prioridade.trim(),
      status: payload.status,
      tipo: payload.tipo,
      empresaId: Number(payload.empresaId),
    },
    include: {
      empresa: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
  });
}

/**
 * Exclui item da agenda que ainda nao foi realizado.
 * @param {number | string} agendaId Identificador do item.
 * @returns {Promise<object>}
 */
async function deleteAgendaItem(agendaId) {
  const agenda = await prisma.agenda.findUnique({
    where: { id: Number(agendaId) },
  });

  if (!agenda) {
    throw new AppError("Item de agenda nao encontrado.", 404);
  }

  if (agenda.status === "REALIZADO") {
    throw new AppError(
      "Nao e possivel excluir item de agenda ja realizado.",
      400,
    );
  }

  return prisma.agenda.delete({
    where: { id: Number(agendaId) },
    select: {
      id: true,
      titulo: true,
    },
  });
}

/**
 * Realiza a baixa de um item da agenda criando a movimentacao correspondente.
 * @param {number | string} agendaId Identificador do item.
 * @param {{ contaId: number | string, data?: string, categoria?: string, tipoDespesa?: string, projetoId?: number | string, subcategoria?: string }} payload Dados complementares da baixa.
 * @returns {Promise<object>}
 */
async function settleAgendaItem(agendaId, payload) {
  return prisma.$transaction(async (tx) => {
    const agenda = await tx.agenda.findUnique({
      where: { id: Number(agendaId) },
      include: {
        empresa: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
    });

    if (!agenda) {
      throw new AppError("Item de agenda nao encontrado.", 404);
    }

    if (agenda.status === "REALIZADO") {
      throw new AppError("Este item de agenda ja foi baixado.", 400);
    }

    const contaField =
      agenda.tipo === "PAGAR" ? "contaOrigemId" : "contaDestinoId";
    const movimentacao = await createMovimentacao(
      {
        data: payload.data || agenda.data,
        empresaId: agenda.empresaId,
        tipo: agenda.tipo === "PAGAR" ? "SAIDA" : "ENTRADA",
        valor: agenda.valor.toString(),
        categoria: payload.categoria || undefined,
        tipoDespesa: payload.tipoDespesa || undefined,
        referencia: agenda.descricao
          ? `${agenda.titulo} - ${agenda.descricao}`
          : agenda.titulo,
        status: "REALIZADO",
        projetoId: payload.projetoId ? Number(payload.projetoId) : undefined,
        subcategoria: payload.subcategoria || undefined,
        [contaField]: Number(payload.contaId),
      },
      { tx },
    );

    const agendaAtualizada = await tx.agenda.update({
      where: { id: agenda.id },
      data: { status: "REALIZADO" },
      include: {
        empresa: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
    });

    return {
      agenda: agendaAtualizada,
      movimentacao,
    };
  });
}

module.exports = {
  createAgendaItem,
  deleteAgendaItem,
  getAgendaSettlementHistory,
  getAgendaItems,
  settleAgendaItem,
  updateAgendaItem,
};

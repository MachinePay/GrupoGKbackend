const { AgendaStatus, Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const {
  createMovimentacao,
  deleteMovimentacao,
} = require("./movimentacaoService");

/**
 * Converte valores para Decimal do Prisma.
 * @param {number | string} value Valor bruto.
 * @returns {Prisma.Decimal}
 */
function toDecimal(value) {
  return new Prisma.Decimal(value);
}

/**
 * Monta a referencia padrao de movimentacao para um item de agenda.
 * @param {{ titulo: string, descricao?: string | null }} source
 * @returns {string}
 */
function buildAgendaReference(source) {
  const titulo = String(source.titulo || "").trim();
  const descricao = source.descricao ? String(source.descricao).trim() : "";

  return descricao ? `${titulo} - ${descricao}` : titulo;
}

/**
 * Retorna o tipo de movimentacao equivalente ao tipo da agenda.
 * @param {"PAGAR" | "RECEBER"} agendaTipo
 * @returns {"SAIDA" | "ENTRADA"}
 */
function getMovimentacaoTipoFromAgendaTipo(agendaTipo) {
  return agendaTipo === "PAGAR" ? "SAIDA" : "ENTRADA";
}

/**
 * Busca a movimentacao vinculada a um item de agenda realizado.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {object} agenda
 * @returns {Promise<object | null>}
 */
async function findLinkedMovimentacao(tx, agenda) {
  const referencia =
    agenda.origemExterna && agenda.referenciaExternaId
      ? `Aprovado via AgarraMais - ${agenda.referenciaExternaId}`
      : buildAgendaReference(agenda);

  const matches = await tx.movimentacao.findMany({
    where: {
      empresaId: agenda.empresaId,
      status: "REALIZADO",
      tipo: getMovimentacaoTipoFromAgendaTipo(agenda.tipo),
      valor: agenda.valor,
      referencia,
    },
    select: {
      id: true,
      valor: true,
      tipo: true,
      contaOrigemId: true,
      contaDestinoId: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 2,
  });

  if (matches.length > 1) {
    throw new AppError(
      "Mais de uma movimentacao realizada corresponde a este item. Edite ou exclua pelo modulo de Lancamentos para manter consistencia.",
      409,
    );
  }

  return matches[0] ?? null;
}

/**
 * Aplica ajuste de saldo quando o valor de uma movimentacao realizada e alterado.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ tipo: string, contaOrigemId?: number | null, contaDestinoId?: number | null, valor: Prisma.Decimal }} movimentacao
 * @param {Prisma.Decimal} novoValor
 * @returns {Promise<void>}
 */
async function applySaldoDiffForMovimentacaoUpdate(
  tx,
  movimentacao,
  novoValor,
) {
  const diferenca = new Prisma.Decimal(novoValor).minus(movimentacao.valor);

  if (diferenca.equals(0)) {
    return;
  }

  if (movimentacao.tipo === "ENTRADA" && movimentacao.contaDestinoId) {
    await tx.contaBancaria.update({
      where: { id: movimentacao.contaDestinoId },
      data: diferenca.gte(0)
        ? { saldoAtual: { increment: diferenca } }
        : { saldoAtual: { decrement: diferenca.abs() } },
    });
  }

  if (movimentacao.tipo === "SAIDA" && movimentacao.contaOrigemId) {
    await tx.contaBancaria.update({
      where: { id: movimentacao.contaOrigemId },
      data: diferenca.gte(0)
        ? { saldoAtual: { decrement: diferenca } }
        : { saldoAtual: { increment: diferenca.abs() } },
    });
  }
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
 * @param {{ dataInicio?: string, dataFim?: string, status?: string, tipo?: string, empresaId?: number | string, usuarioCriacaoId?: number | string }} filters Filtros da consulta.
 * @returns {Promise<object[]>}
 */
async function getAgendaItems(filters) {
  const where = {
    ...buildAgendaDateFilter(filters.dataInicio, filters.dataFim),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.tipo ? { tipo: filters.tipo } : {}),
    ...(filters.empresaId ? { empresaId: Number(filters.empresaId) } : {}),
    ...(filters.usuarioCriacaoId
      ? { usuarioCriacaoId: Number(filters.usuarioCriacaoId) }
      : {}),
    OR: [
      { origemExterna: false },
      {
        AND: [
          { origemExterna: true },
          { status: AgendaStatus.REALIZADO },
          { usuarioAprovadorId: { not: null } },
        ],
      },
    ],
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
      fornecedor: {
        select: {
          id: true,
          nome: true,
        },
      },
      usuarioCriacao: {
        select: {
          id: true,
          nome: true,
          email: true,
        },
      },
    },
    orderBy: [{ data: "asc" }, { prioridade: "asc" }],
  });
}

/**
 * Lista historico de itens baixados da agenda.
 * @param {{ dataInicio?: string, dataFim?: string, empresaId?: number | string, usuarioCriacaoId?: number | string, limit?: number | string, page?: number | string }} filters Filtros da consulta.
 * @returns {Promise<{ items: object[], pagination: { page: number, limit: number, total: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean } }>}
 */
async function getAgendaSettlementHistory(filters) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));

  const where = {
    ...buildAgendaDateFilter(filters.dataInicio, filters.dataFim),
    status: "REALIZADO",
    ...(filters.empresaId ? { empresaId: Number(filters.empresaId) } : {}),
    ...(filters.usuarioCriacaoId
      ? { usuarioCriacaoId: Number(filters.usuarioCriacaoId) }
      : {}),
    OR: [
      { origemExterna: false },
      {
        AND: [{ origemExterna: true }, { usuarioAprovadorId: { not: null } }],
      },
    ],
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
        fornecedor: {
          select: {
            id: true,
            nome: true,
          },
        },
        usuarioCriacao: {
          select: {
            id: true,
            nome: true,
            email: true,
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
 * Retorna lista de fornecedores ativos.
 * @returns {Promise<object[]>}
 */
async function getFornecedores() {
  return prisma.fornecedor.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
    },
  });
}

/**
 * Cria um item de agenda com suporte a novos campos e recorrência automática.
 * @param {{ data: string, titulo: string, descricao?: string, valor: number | string, prioridade: string, status: string, tipo: string, empresaId: number, origem?: string, origemTipo?: string, tipoPagamento?: string, fornecedorId?: number, recurrenteAte?: string }} payload Dados do item.
 * @returns {Promise<object | object[]>}
 */
async function createAgendaItem(payload, usuarioId) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: Number(payload.empresaId) },
  });

  if (!empresa) {
    throw new AppError("Empresa nao encontrada para vincular agenda.", 404);
  }

  // Validar fornecedor se origemTipo = FORNECEDOR
  if (payload.origemTipo === "FORNECEDOR" && payload.fornecedorId) {
    const fornecedor = await prisma.fornecedor.findUnique({
      where: { id: Number(payload.fornecedorId) },
    });
    if (!fornecedor) {
      throw new AppError("Fornecedor nao encontrado.", 404);
    }
  }

  // Validar duplicata: mesmo titulo, data, valor, empresa e fornecedor criados pelo mesmo usuário nas últimas 24h
  if (usuarioId) {
    const dataInicio = new Date();
    dataInicio.setHours(dataInicio.getHours() - 24);

    const duplicata = await prisma.agenda.findFirst({
      where: {
        titulo: payload.titulo.trim(),
        valor: toDecimal(payload.valor),
        empresaId: Number(payload.empresaId),
        fornecedorId: payload.fornecedorId
          ? Number(payload.fornecedorId)
          : null,
        usuarioCriacaoId: Number(usuarioId),
        createdAt: {
          gte: dataInicio,
        },
      },
    });

    if (duplicata) {
      throw new AppError(
        "Compromisso duplicado detectado. Este compromisso foi criado há menos de 24h.",
        409,
      );
    }
  }

  const data = new Date(payload.data);
  const items = [];

  // Criar item inicial
  const item = await prisma.agenda.create({
    data: {
      data,
      titulo: payload.titulo.trim(),
      descricao: payload.descricao?.trim() || null,
      origem: payload.origem?.trim() || null,
      origemTipo: payload.origemTipo || null,
      tipoPagamento: payload.tipoPagamento || null,
      valor: toDecimal(payload.valor),
      prioridade: payload.prioridade.trim(),
      status: payload.status,
      tipo: payload.tipo,
      recurrenteAte: payload.recurrenteAte
        ? new Date(payload.recurrenteAte)
        : null,
      fornecedorId: payload.fornecedorId ? Number(payload.fornecedorId) : null,
      empresaId: Number(payload.empresaId),
      usuarioCriacaoId: usuarioId ? Number(usuarioId) : null,
    },
    include: {
      empresa: { select: { id: true, nome: true } },
      fornecedor: { select: { id: true, nome: true } },
      usuarioCriacao: { select: { id: true, nome: true, email: true } },
    },
  });

  items.push(item);

  // Se há recorrência, criar itens para os próximos meses
  if (payload.recurrenteAte) {
    const recurrenteAte = new Date(payload.recurrenteAte);
    let currentDate = new Date(data);
    currentDate.setMonth(currentDate.getMonth() + 1);

    while (currentDate <= recurrenteAte) {
      const recurrentItem = await prisma.agenda.create({
        data: {
          data: new Date(currentDate),
          titulo: payload.titulo.trim(),
          descricao: payload.descricao?.trim() || null,
          origem: payload.origem?.trim() || null,
          origemTipo: payload.origemTipo || null,
          tipoPagamento: payload.tipoPagamento || null,
          valor: toDecimal(payload.valor),
          prioridade: payload.prioridade.trim(),
          status: payload.status,
          tipo: payload.tipo,
          recurrenteAte,
          fornecedorId: payload.fornecedorId
            ? Number(payload.fornecedorId)
            : null,
          empresaId: Number(payload.empresaId),
          usuarioCriacaoId: usuarioId ? Number(usuarioId) : null,
        },
        include: {
          empresa: { select: { id: true, nome: true } },
          fornecedor: { select: { id: true, nome: true } },
          usuarioCriacao: { select: { id: true, nome: true, email: true } },
        },
      });
      items.push(recurrentItem);
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  }

  return items.length === 1 ? item : items;
}

/**
 * Atualiza um item da agenda antes da baixa.
 * @param {number | string} agendaId Identificador do item.
 * @param {{ data: string, titulo: string, descricao?: string, valor: number | string, prioridade: string, status: string, tipo: string, empresaId: number, origem?: string, origemTipo?: string, tipoPagamento?: string, fornecedorId?: number, recurrenteAte?: string }} payload Dados do item.
 * @returns {Promise<object>}
 */
async function updateAgendaItem(agendaId, payload) {
  return prisma.$transaction(async (tx) => {
    const [agenda, empresa] = await Promise.all([
      tx.agenda.findUnique({ where: { id: Number(agendaId) } }),
      tx.empresa.findUnique({ where: { id: Number(payload.empresaId) } }),
    ]);

    if (!agenda) {
      throw new AppError("Item de agenda nao encontrado.", 404);
    }

    if (!empresa) {
      throw new AppError("Empresa nao encontrada para vincular agenda.", 404);
    }

    if (agenda.status === "REALIZADO" && payload.status !== "REALIZADO") {
      throw new AppError(
        "Nao e possivel alterar o status de um item ja realizado.",
        400,
      );
    }

    if (agenda.status === "REALIZADO" && payload.tipo !== agenda.tipo) {
      throw new AppError(
        "Nao e possivel alterar o tipo de um item ja realizado.",
        400,
      );
    }

    // Validar fornecedor se origemTipo = FORNECEDOR
    if (payload.origemTipo === "FORNECEDOR" && payload.fornecedorId) {
      const fornecedor = await tx.fornecedor.findUnique({
        where: { id: Number(payload.fornecedorId) },
      });
      if (!fornecedor) {
        throw new AppError("Fornecedor nao encontrado.", 404);
      }
    }

    if (agenda.status === "REALIZADO") {
      const movimentacao = await findLinkedMovimentacao(tx, agenda);

      if (movimentacao) {
        const novoValor = toDecimal(payload.valor);
        await applySaldoDiffForMovimentacaoUpdate(tx, movimentacao, novoValor);

        const novaReferencia =
          agenda.origemExterna && agenda.referenciaExternaId
            ? `Aprovado via AgarraMais - ${agenda.referenciaExternaId}`
            : buildAgendaReference({
                titulo: payload.titulo,
                descricao: payload.descricao,
              });

        await tx.movimentacao.update({
          where: { id: movimentacao.id },
          data: {
            data: new Date(payload.data),
            valor: novoValor,
            empresaId: Number(payload.empresaId),
            referencia: novaReferencia,
          },
        });
      }
    }

    return tx.agenda.update({
      where: { id: Number(agendaId) },
      data: {
        data: new Date(payload.data),
        titulo: payload.titulo.trim(),
        descricao: payload.descricao?.trim() || null,
        origem: payload.origem?.trim() || null,
        origemTipo: payload.origemTipo || null,
        tipoPagamento: payload.tipoPagamento || null,
        valor: toDecimal(payload.valor),
        prioridade: payload.prioridade.trim(),
        status: payload.status,
        tipo: payload.tipo,
        recurrenteAte: payload.recurrenteAte
          ? new Date(payload.recurrenteAte)
          : null,
        fornecedorId: payload.fornecedorId
          ? Number(payload.fornecedorId)
          : null,
        empresaId: Number(payload.empresaId),
      },
      include: {
        empresa: { select: { id: true, nome: true } },
        fornecedor: { select: { id: true, nome: true } },
        usuarioCriacao: { select: { id: true, nome: true, email: true } },
      },
    });
  });
}

/**
 * Exclui item da agenda que ainda nao foi realizado.
 * @param {number | string} agendaId Identificador do item.
 * @returns {Promise<object>}
 */
async function deleteAgendaItem(agendaId) {
  return prisma.$transaction(async (tx) => {
    const agenda = await tx.agenda.findUnique({
      where: { id: Number(agendaId) },
    });

    if (!agenda) {
      throw new AppError("Item de agenda nao encontrado.", 404);
    }

    if (agenda.status === "REALIZADO") {
      const movimentacao = await findLinkedMovimentacao(tx, agenda);

      if (movimentacao) {
        await deleteMovimentacao(movimentacao.id, { tx });
      }
    }

    return tx.agenda.delete({
      where: { id: Number(agendaId) },
      select: {
        id: true,
        titulo: true,
      },
    });
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
        usuarioCriacao: {
          select: {
            id: true,
            nome: true,
            email: true,
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
  getFornecedores,
  getAgendaSettlementHistory,
  getAgendaItems,
  settleAgendaItem,
  updateAgendaItem,
};

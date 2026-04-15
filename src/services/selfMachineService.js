const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

/**
 * Converte Decimal/nullable em numero.
 * @param {import("@prisma/client").Prisma.Decimal | null | undefined} value
 * @returns {number | null}
 */
function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value.toString());
}

/**
 * Normaliza contrato para resposta da API.
 * @param {object} contrato
 * @returns {object}
 */
function normalizeContrato(contrato) {
  return {
    ...contrato,
    valorDesenvolvimento: decimalToNumber(contrato.valorDesenvolvimento),
    valorMensalidade: decimalToNumber(contrato.valorMensalidade),
    temPedidoLancado: Boolean(contrato.temPedidoLancado),
    temPagamentoLancado: Boolean(contrato.temPagamentoLancado),
  };
}

/**
 * Marca contratos com flags de lancamentos vinculados.
 * @param {Array<object>} contratos
 * @returns {Promise<Array<object>>}
 */
async function attachLancamentoFlagsToContratos(contratos) {
  if (!contratos.length) {
    return contratos;
  }

  const contratoIds = contratos.map((item) => Number(item.id));

  const pedidos = await prisma.movimentacao.findMany({
    where: {
      saasClienteId: { in: contratoIds },
      categoria: "PEDIDO",
    },
    select: { saasClienteId: true },
    distinct: ["saasClienteId"],
  });

  const contratosComPedido = new Set(
    pedidos
      .map((item) => item.saasClienteId)
      .filter((value) => value !== null && value !== undefined),
  );

  const pagamentos = await prisma.movimentacao.findMany({
    where: {
      saasClienteId: { in: contratoIds },
      saasLancamentoTipo: "PAGAMENTO",
      status: "REALIZADO",
    },
    select: { saasClienteId: true },
    distinct: ["saasClienteId"],
  });

  const contratosComPagamento = new Set(
    pagamentos
      .map((item) => item.saasClienteId)
      .filter((value) => value !== null && value !== undefined),
  );

  return contratos.map((contrato) => ({
    ...contrato,
    temPedidoLancado: contratosComPedido.has(Number(contrato.id)),
    temPagamentoLancado: contratosComPagamento.has(Number(contrato.id)),
  }));
}

/**
 * Verifica se duas datas estao no mesmo mes/ano.
 * @param {Date | null | undefined} left
 * @param {Date | null | undefined} right
 * @returns {boolean}
 */
function isSameMonthYear(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

/**
 * Calcula o vencimento da mensalidade para o mes de referencia.
 * @param {Date} dataInicioMensalidade
 * @param {Date} referenceDate
 * @returns {Date}
 */
function getMesVencimento(dataInicioMensalidade, referenceDate) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const diaBase = dataInicioMensalidade.getDate();
  const ultimoDiaMes = new Date(year, month + 1, 0).getDate();
  const diaVencimento = Math.min(diaBase, ultimoDiaMes);

  return new Date(year, month, diaVencimento, 23, 59, 59, 999);
}

/**
 * Atualiza status mensalidade com base na data atual e status geral do sistema.
 * @param {object} contrato
 * @returns {{ statusMensalidade: string, needsUpdate: boolean }}
 */
function getStatusMensalidadeCalculado(contrato) {
  if (contrato.statusSistema === "PAUSADO") {
    return {
      statusMensalidade: "PAUSADO",
      needsUpdate: contrato.statusMensalidade !== "PAUSADO",
    };
  }

  if (contrato.statusSistema === "ATRASADO") {
    return {
      statusMensalidade: "ATRASADO",
      needsUpdate: contrato.statusMensalidade !== "ATRASADO",
    };
  }

  const hoje = new Date();
  const inicioMensalidade = new Date(contrato.dataInicioMensalidade);
  const ultimaMensalidadePagaEm = contrato.ultimaMensalidadePagaEm
    ? new Date(contrato.ultimaMensalidadePagaEm)
    : null;

  if (hoje < inicioMensalidade) {
    return {
      statusMensalidade: "AGUARDANDO_PAGAMENTO",
      needsUpdate: contrato.statusMensalidade !== "AGUARDANDO_PAGAMENTO",
    };
  }

  if (isSameMonthYear(ultimaMensalidadePagaEm, hoje)) {
    return {
      statusMensalidade: "PAGO",
      needsUpdate: contrato.statusMensalidade !== "PAGO",
    };
  }

  const vencimentoMesAtual = getMesVencimento(inicioMensalidade, hoje);

  if (hoje > vencimentoMesAtual) {
    return {
      statusMensalidade: "ATRASADO",
      needsUpdate: contrato.statusMensalidade !== "ATRASADO",
    };
  }

  if (contrato.statusMensalidade === "EM_ABERTO") {
    return {
      statusMensalidade: "EM_ABERTO",
      needsUpdate: false,
    };
  }

  return {
    statusMensalidade: "AGUARDANDO_PAGAMENTO",
    needsUpdate: contrato.statusMensalidade !== "AGUARDANDO_PAGAMENTO",
  };
}

/**
 * Recalcula status dos contratos cadastrados.
 * @returns {Promise<void>}
 */
async function refreshMensalidadeStatuses() {
  try {
    const contratos = await prisma.saasCliente.findMany({
      select: {
        id: true,
        statusSistema: true,
        statusMensalidade: true,
        dataInicioMensalidade: true,
        ultimaMensalidadePagaEm: true,
      },
    });

    const updates = contratos
      .map((contrato) => ({
        id: contrato.id,
        ...getStatusMensalidadeCalculado(contrato),
      }))
      .filter((item) => item.needsUpdate)
      .map((item) =>
        prisma.saasCliente.update({
          where: { id: item.id },
          data: { statusMensalidade: item.statusMensalidade },
        }),
      );

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
  } catch (err) {
    console.error("Erro em refreshMensalidadeStatuses:", err);
    // Silently fail, nao interrompe listagem
  }
}

/**
 * Recalcula status de mensalidade de um contrato especifico.
 * @param {number | string} contratoId
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} client
 * @returns {Promise<object>}
 */
async function recomputeContratoMensalidadeStatus(contratoId, client = prisma) {
  const contrato = await client.saasCliente.findUnique({
    where: { id: Number(contratoId) },
  });

  if (!contrato) {
    throw new AppError("Contrato SaaS nao encontrado.", 404);
  }

  const next = getStatusMensalidadeCalculado(contrato);

  if (next.needsUpdate) {
    const updated = await client.saasCliente.update({
      where: { id: contrato.id },
      data: { statusMensalidade: next.statusMensalidade },
    });

    return normalizeContrato(updated);
  }

  return normalizeContrato(contrato);
}

/**
 * Registra pagamento de mensalidade e marca cliente como pago no mes.
 * @param {number | string} contratoId
 * @param {Date} dataPagamento
 * @param {import("@prisma/client").Prisma.TransactionClient | typeof prisma} client
 * @returns {Promise<object>}
 */
async function registerMensalidadePagamento(
  contratoId,
  dataPagamento,
  client = prisma,
) {
  const contrato = await client.saasCliente.findUnique({
    where: { id: Number(contratoId) },
    select: { id: true },
  });

  if (!contrato) {
    throw new AppError("Contrato SaaS nao encontrado.", 404);
  }

  const updated = await client.saasCliente.update({
    where: { id: Number(contratoId) },
    data: {
      ultimaMensalidadePagaEm: dataPagamento,
      statusMensalidade: "PAGO",
    },
  });

  return normalizeContrato(updated);
}

/**
 * Valida payload base de contrato SaaS.
 * @param {object} payload
 * @param {boolean} partial
 */
function validateContratoPayload(payload, partial = false) {
  const requiredFields = [
    "nomeCliente",
    "nomeSistema",
    "vendedor",
    "numeroPc",
    "dataEmissao",
    "tipoRemessa",
    "valorMensalidade",
    "dataInicioMensalidade",
    "tipoPlano",
  ];

  if (!partial) {
    for (const field of requiredFields) {
      if (
        payload[field] === undefined ||
        payload[field] === null ||
        String(payload[field]).trim() === ""
      ) {
        throw new AppError(`Campo ${field} obrigatorio.`, 400);
      }
    }
  }

  const meioPagamentoNormalizado = payload.meioPagamento
    ? String(payload.meioPagamento).trim().toUpperCase()
    : null;

  if (
    !partial &&
    meioPagamentoNormalizado === "PIX" &&
    String(payload.chavePix || "").trim() === ""
  ) {
    throw new AppError(
      "Campo chavePix obrigatorio quando meioPagamento for PIX.",
      400,
    );
  }

  if (
    payload.valorMensalidade !== undefined &&
    (Number.isNaN(Number(payload.valorMensalidade)) ||
      Number(payload.valorMensalidade) < 0)
  ) {
    throw new AppError("Campo valorMensalidade invalido.", 400);
  }

  if (
    payload.valorDesenvolvimento !== undefined &&
    payload.valorDesenvolvimento !== null &&
    (Number.isNaN(Number(payload.valorDesenvolvimento)) ||
      Number(payload.valorDesenvolvimento) < 0)
  ) {
    throw new AppError("Campo valorDesenvolvimento invalido.", 400);
  }

  if (
    payload.dataEmissao !== undefined &&
    Number.isNaN(new Date(payload.dataEmissao).getTime())
  ) {
    throw new AppError("Campo dataEmissao invalido.", 400);
  }

  if (
    payload.dataInicioMensalidade !== undefined &&
    Number.isNaN(new Date(payload.dataInicioMensalidade).getTime())
  ) {
    throw new AppError("Campo dataInicioMensalidade invalido.", 400);
  }

  if (
    payload.tipoRemessa &&
    !["UNICA", "RECORRENTE"].includes(payload.tipoRemessa)
  ) {
    throw new AppError("Campo tipoRemessa invalido.", 400);
  }

  if (payload.tipoPlano && !["FULL", "SMALL"].includes(payload.tipoPlano)) {
    throw new AppError("Campo tipoPlano invalido.", 400);
  }

  if (
    payload.statusSistema &&
    !["ATIVO", "PAUSADO", "ATRASADO", "ENTREGUE"].includes(
      payload.statusSistema,
    )
  ) {
    throw new AppError("Campo statusSistema invalido.", 400);
  }

  if (
    payload.statusMensalidade &&
    ![
      "AGUARDANDO_PAGAMENTO",
      "EM_ABERTO",
      "PAGO",
      "ATRASADO",
      "PAUSADO",
    ].includes(payload.statusMensalidade)
  ) {
    throw new AppError("Campo statusMensalidade invalido.", 400);
  }
}

/**
 * Mapeia payload para data do Prisma.
 * @param {object} payload
 * @returns {object}
 */
function mapPayloadToData(payload) {
  return {
    ...(payload.nomeCliente !== undefined && {
      nomeCliente: String(payload.nomeCliente).trim(),
    }),
    ...(payload.nomeSistema !== undefined && {
      nomeSistema: String(payload.nomeSistema).trim(),
    }),
    ...(payload.logoParceiraUrl !== undefined && {
      logoParceiraUrl: payload.logoParceiraUrl?.trim() || null,
    }),
    ...(payload.logoSelfMachineUrl !== undefined && {
      logoSelfMachineUrl: payload.logoSelfMachineUrl?.trim() || null,
    }),
    ...(payload.vendedor !== undefined && {
      vendedor: String(payload.vendedor).trim(),
    }),
    ...(payload.numeroPc !== undefined && {
      numeroPc: String(payload.numeroPc).trim(),
    }),
    ...(payload.dataEmissao !== undefined && {
      dataEmissao: new Date(payload.dataEmissao),
    }),
    ...(payload.tipoRemessa !== undefined && {
      tipoRemessa: payload.tipoRemessa,
    }),
    ...(payload.valorDesenvolvimento !== undefined && {
      valorDesenvolvimento:
        payload.valorDesenvolvimento === null ||
        payload.valorDesenvolvimento === ""
          ? null
          : Number(payload.valorDesenvolvimento),
    }),
    ...(payload.valorMensalidade !== undefined && {
      valorMensalidade: Number(payload.valorMensalidade),
    }),
    ...(payload.dataInicioMensalidade !== undefined && {
      dataInicioMensalidade: new Date(payload.dataInicioMensalidade),
    }),
    ...(payload.condicoesPagamento !== undefined && {
      condicoesPagamento: payload.condicoesPagamento?.trim() || null,
    }),
    ...(payload.meioPagamento !== undefined && {
      meioPagamento: payload.meioPagamento?.trim() || null,
    }),
    ...(payload.chavePix !== undefined && {
      chavePix: payload.chavePix?.trim() || null,
    }),
    ...(payload.statusSistema !== undefined && {
      statusSistema: payload.statusSistema,
    }),
    ...(payload.statusMensalidade !== undefined && {
      statusMensalidade: payload.statusMensalidade,
    }),
    ...(payload.ultimaMensalidadePagaEm !== undefined && {
      ultimaMensalidadePagaEm: payload.ultimaMensalidadePagaEm
        ? new Date(payload.ultimaMensalidadePagaEm)
        : null,
    }),
    ...(payload.tipoPlano !== undefined && {
      tipoPlano: payload.tipoPlano,
    }),
    ...(payload.descricao !== undefined && {
      descricao: payload.descricao?.trim() || null,
    }),
    ...(payload.prazosDescricao !== undefined && {
      prazosDescricao: payload.prazosDescricao?.trim() || null,
    }),
  };
}

/**
 * Lista todos os contratos SaaS da SelfMachine.
 * @returns {Promise<object[]>}
 */
async function listSaasContratos() {
  try {
    await refreshMensalidadeStatuses();
  } catch (err) {
    console.error("Erro ao atualizar status de mensalidade:", err);
    // Continua mesmo se houver erro na atualizacao
  }

  const data = await prisma.saasCliente.findMany({
    orderBy: [{ statusSistema: "asc" }, { nomeCliente: "asc" }],
  });

  const dataWithPedidoFlag = await attachLancamentoFlagsToContratos(data);

  return dataWithPedidoFlag.map(normalizeContrato);
}

/**
 * Retorna um contrato por id.
 * @param {number | string} id
 * @returns {Promise<object>}
 */
async function getSaasContratoById(id) {
  const contrato = await prisma.saasCliente.findUnique({
    where: { id: Number(id) },
  });

  if (!contrato) {
    throw new AppError("Contrato SaaS nao encontrado.", 404);
  }

  const [contratoWithPedidoFlag] = await attachLancamentoFlagsToContratos([
    contrato,
  ]);

  return normalizeContrato(contratoWithPedidoFlag);
}

/**
 * Cria um novo contrato SaaS.
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function createSaasContrato(payload) {
  validateContratoPayload(payload, false);

  const contrato = await prisma.saasCliente.create({
    data: {
      ...mapPayloadToData(payload),
      statusMensalidade: payload.statusMensalidade || "AGUARDANDO_PAGAMENTO",
      logoSelfMachineUrl:
        payload.logoSelfMachineUrl ||
        "https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=640&auto=format&fit=crop",
    },
  });

  return normalizeContrato(contrato);
}

/**
 * Atualiza um contrato SaaS.
 * @param {number | string} id
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function updateSaasContrato(id, payload) {
  validateContratoPayload(payload, true);

  const exists = await prisma.saasCliente.findUnique({
    where: { id: Number(id) },
    select: { id: true, meioPagamento: true, chavePix: true },
  });

  if (!exists) {
    throw new AppError("Contrato SaaS nao encontrado.", 404);
  }

  const meioPagamentoFinal =
    payload.meioPagamento !== undefined
      ? String(payload.meioPagamento || "")
          .trim()
          .toUpperCase()
      : String(exists.meioPagamento || "")
          .trim()
          .toUpperCase();
  const chavePixFinal =
    payload.chavePix !== undefined
      ? String(payload.chavePix || "").trim()
      : String(exists.chavePix || "").trim();

  if (meioPagamentoFinal === "PIX" && chavePixFinal === "") {
    throw new AppError(
      "Campo chavePix obrigatorio quando meioPagamento for PIX.",
      400,
    );
  }

  const contrato = await prisma.saasCliente.update({
    where: { id: Number(id) },
    data: mapPayloadToData(payload),
  });

  return normalizeContrato(contrato);
}

/**
 * Exclui um contrato SaaS.
 * @param {number | string} id
 * @returns {Promise<object>}
 */
async function deleteSaasContrato(id) {
  const exists = await prisma.saasCliente.findUnique({
    where: { id: Number(id) },
    select: { id: true, nomeCliente: true },
  });

  if (!exists) {
    throw new AppError("Contrato SaaS nao encontrado.", 404);
  }

  await prisma.saasCliente.delete({
    where: { id: Number(id) },
  });

  return { id: exists.id, nomeCliente: exists.nomeCliente };
}

/**
 * Gera um pedido de pagamento (estado do mes vira EM_ABERTO).
 * @param {number | string} id
 * @returns {Promise<object>}
 */
async function gerarPedidoPagamento(id) {
  const exists = await prisma.saasCliente.findUnique({
    where: { id: Number(id) },
    select: { id: true },
  });

  if (!exists) {
    throw new AppError("Contrato SaaS nao encontrado.", 404);
  }

  const updated = await prisma.saasCliente.update({
    where: { id: Number(id) },
    data: {
      statusMensalidade: "EM_ABERTO",
      ultimoPedidoPagamentoAt: new Date(),
    },
  });

  return normalizeContrato(updated);
}

/**
 * Gera relatorio completo da operação SelfMachine SaaS.
 * @returns {Promise<object>}
 */
async function getSaasRelatorio() {
  const contratos = await prisma.saasCliente.findMany({
    select: {
      id: true,
      nomeCliente: true,
      nomeSistema: true,
      tipoPlano: true,
      statusSistema: true,
      statusMensalidade: true,
      valorMensalidade: true,
      valorDesenvolvimento: true,
      dataInicioMensalidade: true,
      createdAt: true,
    },
  });

  const movimentacoes = await prisma.movimentacao.findMany({
    where: { saasClienteId: { not: null } },
    select: {
      id: true,
      tipo: true,
      valor: true,
      data: true,
      categoria: true,
      status: true,
      saasClienteId: true,
      saasCliente: { select: { nomeCliente: true, nomeSistema: true } },
    },
    orderBy: { data: "asc" },
  });

  const hoje = new Date();
  const mesAnteriorDate = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);

  // Resumo contratos
  const ativos = contratos.filter((c) => c.statusSistema === "ATIVO");
  const atrasados = contratos.filter(
    (c) => c.statusSistema === "ATRASADO" || c.statusMensalidade === "ATRASADO",
  );
  const pausados = contratos.filter((c) => c.statusSistema === "PAUSADO");

  const mrr = ativos.reduce(
    (acc, c) => acc + Number(c.valorMensalidade || 0),
    0,
  );
  const arr = mrr * 12;
  const ticketMedio = ativos.length ? mrr / ativos.length : 0;
  const totalSetupCobrado = contratos.reduce(
    (acc, c) => acc + Number(c.valorDesenvolvimento || 0),
    0,
  );

  // Financeiro
  const entradas = movimentacoes.filter((m) => m.tipo === "ENTRADA");
  const saidas = movimentacoes.filter((m) => m.tipo === "SAIDA");

  const receitaRealizada = entradas.reduce(
    (acc, m) => acc + Number(m.valor || 0),
    0,
  );
  const despesasTotal = saidas.reduce(
    (acc, m) => acc + Number(m.valor || 0),
    0,
  );
  const lucro = receitaRealizada - despesasTotal;
  const margemLucro =
    receitaRealizada > 0 ? (lucro / receitaRealizada) * 100 : 0;

  // Gastos por categoria
  const gastosMap = {};
  for (const m of saidas) {
    const cat = m.categoria || "OUTROS";
    gastosMap[cat] = (gastosMap[cat] || 0) + Number(m.valor || 0);
  }
  const gastosPorCategoria = Object.entries(gastosMap)
    .map(([categoria, valor]) => ({
      categoria,
      valor,
      percentual: despesasTotal > 0 ? (valor / despesasTotal) * 100 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  // Receita por cliente
  const receitaClienteMap = {};
  for (const m of entradas) {
    const key = m.saasClienteId;
    if (!receitaClienteMap[key]) {
      receitaClienteMap[key] = {
        nomeCliente: m.saasCliente?.nomeCliente || "Desconhecido",
        nomeSistema: m.saasCliente?.nomeSistema || "-",
        valor: 0,
        count: 0,
        mensalidade: 0,
      };
    }
    receitaClienteMap[key].valor += Number(m.valor || 0);
    receitaClienteMap[key].count += 1;
  }

  for (const rc of Object.values(receitaClienteMap)) {
    const contrato = contratos.find((c) => c.nomeCliente === rc.nomeCliente);
    if (contrato) {
      rc.mensalidade = Number(contrato.valorMensalidade || 0);
    }
  }

  const receitasPorCliente = Object.values(receitaClienteMap).sort(
    (a, b) => b.valor - a.valor,
  );

  // Histórico mensal (últimos 12 meses)
  const historicoMensal = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const label = d
      .toLocaleString("pt-BR", { month: "short", year: "2-digit" })
      .replace(".", "");
    const labelFormatado =
      label.charAt(0).toUpperCase() + label.slice(1).replace(" de", "");

    const monthEntradas = entradas.filter((m) => {
      const md = new Date(m.data);
      return (
        md.getFullYear() === d.getFullYear() && md.getMonth() === d.getMonth()
      );
    });
    const monthSaidas = saidas.filter((m) => {
      const md = new Date(m.data);
      return (
        md.getFullYear() === d.getFullYear() && md.getMonth() === d.getMonth()
      );
    });

    const entradasTotal = monthEntradas.reduce(
      (acc, m) => acc + Number(m.valor || 0),
      0,
    );
    const saidasTotal = monthSaidas.reduce(
      (acc, m) => acc + Number(m.valor || 0),
      0,
    );

    historicoMensal.push({
      mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: labelFormatado,
      entradas: entradasTotal,
      saidas: saidasTotal,
      saldo: entradasTotal - saidasTotal,
    });
  }

  // Crescimento (contratos criados este mês vs anterior)
  const contratosEsteMes = contratos.filter((c) => {
    const cd = new Date(c.createdAt);
    return (
      cd.getFullYear() === hoje.getFullYear() &&
      cd.getMonth() === hoje.getMonth()
    );
  }).length;

  const contratosMesAnterior = contratos.filter((c) => {
    const cd = new Date(c.createdAt);
    return (
      cd.getFullYear() === mesAnteriorDate.getFullYear() &&
      cd.getMonth() === mesAnteriorDate.getMonth()
    );
  }).length;

  const taxaCrescimento =
    contratosMesAnterior > 0
      ? ((contratosEsteMes - contratosMesAnterior) / contratosMesAnterior) * 100
      : contratosEsteMes > 0
        ? 100
        : 0;

  // Distribuição por plano
  const distribuicaoPlanos = ["FULL", "SMALL"].map((plano) => ({
    plano,
    count: contratos.filter((c) => c.tipoPlano === plano).length,
    mrr: contratos
      .filter((c) => c.tipoPlano === plano && c.statusSistema === "ATIVO")
      .reduce((acc, c) => acc + Number(c.valorMensalidade || 0), 0),
    mrrPotencial: contratos
      .filter((c) => c.tipoPlano === plano)
      .reduce((acc, c) => acc + Number(c.valorMensalidade || 0), 0),
  }));

  // Receita MRR recente (entradas de pagamento dos últimos 30 dias)
  const trintaDiasAtras = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const receita30Dias = entradas
    .filter((m) => new Date(m.data) >= trintaDiasAtras)
    .reduce((acc, m) => acc + Number(m.valor || 0), 0);

  return {
    resumo: {
      mrr,
      arr,
      ticketMedio,
      totalSetupCobrado,
      totalContratos: contratos.length,
      contratosAtivos: ativos.length,
      contratosAtrasados: atrasados.length,
      contratosPausados: pausados.length,
      receita30Dias,
    },
    financeiro: { receitaRealizada, despesasTotal, lucro, margemLucro },
    gastosPorCategoria,
    receitasPorCliente,
    historicoMensal,
    crescimento: { contratosEsteMes, contratosMesAnterior, taxaCrescimento },
    distribuicaoPlanos,
  };
}

module.exports = {
  listSaasContratos,
  getSaasContratoById,
  createSaasContrato,
  updateSaasContrato,
  deleteSaasContrato,
  gerarPedidoPagamento,
  recomputeContratoMensalidadeStatus,
  registerMensalidadePagamento,
  getSaasRelatorio,
};

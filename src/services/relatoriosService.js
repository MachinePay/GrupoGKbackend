const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

/**
 * Extrai um valor decimal agregado retornando zero quando nulo.
 */
function decimalToNumber(value) {
  return value ? Number(value.toString()) : 0;
}

/**
 * Formata uma data para YYYY-MM-DD
 */
function formatDateKey(date, groupBy) {
  const d = new Date(date);
  if (groupBy === "dia") {
    return d.toISOString().split("T")[0];
  } else if (groupBy === "mes") {
    return d.toISOString().slice(0, 7);
  } else if (groupBy === "ano") {
    return d.toISOString().slice(0, 4);
  }
  return d.toISOString().split("T")[0];
}

/**
 * Valida e retorna o filtro onde das movimentações
 */
function buildWhereFilter(filtros) {
  const where = { status: "REALIZADO" };

  if (filtros.empresaId && filtros.empresaId !== "todas") {
    where.empresaId = Number(filtros.empresaId);
  }

  if (filtros.contaId && filtros.contaId !== "todas") {
    where.OR = [
      { contaOrigemId: Number(filtros.contaId) },
      { contaDestinoId: Number(filtros.contaId) },
    ];
  }

  if (filtros.dataInicio || filtros.dataFim) {
    where.data = {};
    if (filtros.dataInicio) {
      where.data.gte = new Date(filtros.dataInicio);
    }
    if (filtros.dataFim) {
      const fim = new Date(filtros.dataFim);
      fim.setHours(23, 59, 59, 999);
      where.data.lte = fim;
    }
  }

  return where;
}

/**
 * Retorna dados para o gráfico de evolução (Receitas vs Despesas ao longo do tempo)
 */
async function getEvolucaoChart(filtros) {
  const where = buildWhereFilter(filtros);
  const groupBy = filtros.groupBy || "dia";

  const movimentacoes = await prisma.movimentacao.findMany({
    where,
    select: {
      data: true,
      tipo: true,
      valor: true,
    },
    orderBy: { data: "asc" },
  });

  // Agrupar por período
  const mapa = {};
  movimentacoes.forEach((mov) => {
    const chave = formatDateKey(mov.data, groupBy);
    if (!mapa[chave]) {
      mapa[chave] = { entradas: 0, saidas: 0 };
    }
    if (mov.tipo === "ENTRADA") {
      mapa[chave].entradas += decimalToNumber(mov.valor);
    } else if (mov.tipo === "SAIDA") {
      mapa[chave].saidas += decimalToNumber(mov.valor);
    }
  });

  // Converter para array ordenado
  const dados = Object.entries(mapa)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, valores]) => ({
      periodo,
      entradas: parseFloat(valores.entradas.toFixed(2)),
      saidas: parseFloat(valores.saidas.toFixed(2)),
      liquido: parseFloat((valores.entradas - valores.saidas).toFixed(2)),
    }));

  return dados;
}

/**
 * Retorna dados para o gráfico de composição de despesas por categoria
 */
async function getComposicaoDespesas(filtros) {
  const where = buildWhereFilter(filtros);
  where.tipo = "SAIDA";

  const despesas = await prisma.movimentacao.groupBy({
    by: ["categoria"],
    where,
    _sum: { valor: true },
  });

  const dados = despesas
    .filter((d) => d.categoria)
    .map((d) => ({
      categoria: d.categoria,
      valor: decimalToNumber(d._sum.valor),
    }))
    .sort((a, b) => b.valor - a.valor);

  // Calcular total para percentual
  const total = dados.reduce((sum, d) => sum + d.valor, 0);
  dados.forEach((d) => {
    d.percentual =
      total > 0 ? parseFloat(((d.valor / total) * 100).toFixed(2)) : 0;
  });

  return dados;
}

/**
 * Retorna dados para o gráfico de distribuição de receitas por empresa
 */
async function getDistribuicaoReceitas(filtros) {
  const where = buildWhereFilter(filtros);
  where.tipo = "ENTRADA";

  // Remover filtro de empresa se existir para ver todas
  delete where.empresaId;

  const receitas = await prisma.movimentacao.groupBy({
    by: ["empresaId"],
    where,
    _sum: { valor: true },
    _count: { id: true },
  });

  // Buscar nomes das empresas
  const empresas = await prisma.empresa.findMany();
  const empresasMap = Object.fromEntries(empresas.map((e) => [e.id, e.nome]));

  const dados = receitas.map((r) => ({
    empresa: empresasMap[r.empresaId] || `Empresa ${r.empresaId}`,
    valor: decimalToNumber(r._sum.valor),
    quantidade: r._count.id,
  }));

  // Calcular percentual
  const total = dados.reduce((sum, d) => sum + d.valor, 0);
  dados.forEach((d) => {
    d.percentual =
      total > 0 ? parseFloat(((d.valor / total) * 100).toFixed(2)) : 0;
  });

  return dados.sort((a, b) => b.valor - a.valor);
}

/**
 * Retorna ranking de projetos da MaisQuiosque
 */
async function getRankingProjetos(filtros) {
  // Encontrar empresa MaisQuiosque
  const empresaMq = await prisma.empresa.findUnique({
    where: { nome: "MaisQuiosque" },
    include: { projetos: true },
  });

  if (!empresaMq) {
    return [];
  }

  const where = buildWhereFilter(filtros);
  where.empresaId = empresaMq.id;

  // Agrupar por projeto
  const projetos = await prisma.movimentacao.groupBy({
    by: ["projetoId"],
    where,
    _sum: { valor: true },
  });

  // Buscar detalhes dos projetos
  const projetosDetalhes = await prisma.projeto.findMany({
    where: { empresaId: empresaMq.id },
  });
  const projetosMap = Object.fromEntries(
    projetosDetalhes.map((p) => [p.id, p.nome]),
  );

  // Calcular receitas e despesas por projeto
  const dados = [];
  for (const proj of projetosDetalhes) {
    const [entradas, saidas] = await Promise.all([
      prisma.movimentacao.aggregate({
        _sum: { valor: true },
        where: { ...where, projetoId: proj.id, tipo: "ENTRADA" },
      }),
      prisma.movimentacao.aggregate({
        _sum: { valor: true },
        where: { ...where, projetoId: proj.id, tipo: "SAIDA" },
      }),
    ]);

    const recebido = decimalToNumber(entradas._sum.valor);
    const gasto = decimalToNumber(saidas._sum.valor);
    const lucroLiquido = recebido - gasto;

    dados.push({
      projeto: proj.nome,
      recebido,
      gasto,
      lucroLiquido,
      margem:
        recebido > 0
          ? parseFloat(((lucroLiquido / recebido) * 100).toFixed(2))
          : 0,
    });
  }

  return dados.sort((a, b) => b.lucroLiquido - a.lucroLiquido);
}

/**
 * Retorna tabela de performance de contas bancárias
 */
async function getTabelaContas(filtros) {
  const contas = await prisma.contaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { nome: "asc" }],
  });

  const where = buildWhereFilter(filtros);

  const dados = [];
  let totalEntradas = 0;
  let totalSaidas = 0;

  for (const conta of contas) {
    const [entradas, saidas] = await Promise.all([
      prisma.movimentacao.aggregate({
        _sum: { valor: true },
        where: {
          ...where,
          contaOrigemId: conta.id,
          tipo: "ENTRADA",
        },
      }),
      prisma.movimentacao.aggregate({
        _sum: { valor: true },
        where: {
          ...where,
          contaDestinoId: conta.id,
          tipo: "SAIDA",
        },
      }),
    ]);

    const movEntradas = decimalToNumber(entradas._sum.valor);
    const movSaidas = decimalToNumber(saidas._sum.valor);
    totalEntradas += movEntradas;
    totalSaidas += movSaidas;

    dados.push({
      banco: conta.banco,
      conta: conta.nome,
      saldoInicial: decimalToNumber(conta.saldoAtual),
      entradas: movEntradas,
      saidas: movSaidas,
      saldoFinal: decimalToNumber(conta.saldoAtual) + movEntradas - movSaidas,
    });
  }

  // Calcular participação
  const totalGeral = totalEntradas + totalSaidas;
  dados.forEach((d) => {
    const movimentacao = d.entradas + d.saidas;
    d.participacao =
      totalGeral > 0
        ? parseFloat(((movimentacao / totalGeral) * 100).toFixed(2))
        : 0;
  });

  return dados;
}

/**
 * Calcula burn rate (média de gastos diários/mensais)
 */
async function calcularBurnRate(filtros) {
  const where = buildWhereFilter(filtros);
  where.tipo = "SAIDA";

  const despesas = await prisma.movimentacao.aggregate({
    _sum: { valor: true },
    where,
  });

  const totalDespesas = decimalToNumber(despesas._sum.valor);

  // Contar dias no período
  let dataInicio = new Date();
  let dataFim = new Date();

  if (filtros.dataInicio) {
    dataInicio = new Date(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    dataFim = new Date(filtros.dataFim);
  }

  const dias = Math.ceil((dataFim - dataInicio) / (1000 * 60 * 60 * 24)) + 1;
  const burnRateDiario =
    dias > 0 ? parseFloat((totalDespesas / dias).toFixed(2)) : 0;
  const burnRateMensal = parseFloat((burnRateDiario * 30).toFixed(2));

  return {
    total: totalDespesas,
    dias,
    burnRateDiario,
    burnRateMensal,
  };
}

/**
 * Calcula ticket médio de entradas
 */
async function calcularTicketMedio(filtros) {
  const where = buildWhereFilter(filtros);
  where.tipo = "ENTRADA";

  const entradas = await prisma.movimentacao.aggregate({
    _sum: { valor: true },
    _count: { id: true },
    where,
  });

  const total = decimalToNumber(entradas._sum.valor);
  const quantidade = entradas._count.id;
  const ticketMedio =
    quantidade > 0 ? parseFloat((total / quantidade).toFixed(2)) : 0;

  return {
    total,
    quantidade,
    ticketMedio,
  };
}

/**
 * Calcula margem de contribuição (Receita - Custos Variáveis)
 */
async function calcularMargemContribuicao(filtros) {
  const where = buildWhereFilter(filtros);

  const [receitas, custosVariaveis] = await Promise.all([
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: { ...where, tipo: "ENTRADA" },
    }),
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: {
        ...where,
        tipo: "SAIDA",
        tipoDespesa: "CUSTOS_OPERACIONAIS",
      },
    }),
  ]);

  const totalReceitas = decimalToNumber(receitas._sum.valor);
  const totalCustosVar = decimalToNumber(custosVariaveis._sum.valor);
  const margem = totalReceitas - totalCustosVar;
  const percentualMargem =
    totalReceitas > 0
      ? parseFloat(((margem / totalReceitas) * 100).toFixed(2))
      : 0;

  return {
    receitas: totalReceitas,
    custosVariaveis: totalCustosVar,
    margem,
    percentualMargem,
  };
}

/**
 * Encontra a categoria com maior crescimento
 */
async function encontrarPontoAtencao(filtros) {
  // Mesês anterior e atual
  const hoje = new Date();
  const mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const inicioMesAtual = new Date(
    mesAtual.getFullYear(),
    mesAtual.getMonth(),
    1,
  );
  const inicioMesAnterior = new Date(
    mesAnterior.getFullYear(),
    mesAnterior.getMonth(),
    1,
  );
  const fimMesAtual = new Date(
    mesAtual.getFullYear(),
    mesAtual.getMonth() + 1,
    0,
    23,
    59,
    59,
  );
  const fimMesAnterior = new Date(
    mesAnterior.getFullYear(),
    mesAnterior.getMonth() + 1,
    0,
    23,
    59,
    59,
  );

  // Somas do mês atual
  const despesasAtuais = await prisma.movimentacao.groupBy({
    by: ["categoria"],
    where: {
      tipo: "SAIDA",
      status: "REALIZADO",
      data: { gte: inicioMesAtual, lte: fimMesAtual },
    },
    _sum: { valor: true },
  });

  // Somas do mês anterior
  const despesasAnteriores = await prisma.movimentacao.groupBy({
    by: ["categoria"],
    where: {
      tipo: "SAIDA",
      status: "REALIZADO",
      data: { gte: inicioMesAnterior, lte: fimMesAnterior },
    },
    _sum: { valor: true },
  });

  // Mapear e calcular crescimento
  const mapaAnterior = {};
  despesasAnteriores.forEach((d) => {
    if (d.categoria) {
      mapaAnterior[d.categoria] = decimalToNumber(d._sum.valor);
    }
  });

  let maiorGrowth = 0;
  let categoriaAtencao = null;

  despesasAtuais.forEach((d) => {
    if (d.categoria) {
      const valorAtual = decimalToNumber(d._sum.valor);
      const valorAnterior = mapaAnterior[d.categoria] || 0;
      const crescimento = valorAtual - valorAnterior;

      if (crescimento > maiorGrowth) {
        maiorGrowth = crescimento;
        categoriaAtencao = {
          categoria: d.categoria,
          mesAnterior: valorAnterior,
          mesAtual: valorAtual,
          crescimento: parseFloat(crescimento.toFixed(2)),
          crescimentoPercentual:
            valorAnterior > 0
              ? parseFloat(((crescimento / valorAnterior) * 100).toFixed(2))
              : 100,
        };
      }
    }
  });

  return (
    categoriaAtencao || {
      categoria: "N/A",
      mesAnterior: 0,
      mesAtual: 0,
      crescimento: 0,
      crescimentoPercentual: 0,
    }
  );
}

/**
 * Retorna dados completos de analytics
 */
async function getAnalytics(filtros) {
  const [
    evolucao,
    composicaoDespesas,
    distribuicaoReceitas,
    rankingProjetos,
    tabelaContas,
    burnRate,
    ticketMedio,
    margemContribuicao,
    pontoAtencao,
  ] = await Promise.all([
    getEvolucaoChart(filtros),
    getComposicaoDespesas(filtros),
    getDistribuicaoReceitas(filtros),
    getRankingProjetos(filtros),
    getTabelaContas(filtros),
    calcularBurnRate(filtros),
    calcularTicketMedio(filtros),
    calcularMargemContribuicao(filtros),
    encontrarPontoAtencao(filtros),
  ]);

  return {
    periodo: {
      inicio: filtros.dataInicio || null,
      fim: filtros.dataFim || null,
      agrupamento: filtros.groupBy || "dia",
    },
    graficos: {
      evolucao,
      composicaoDespesas,
      distribuicaoReceitas,
      rankingProjetos,
    },
    tabelas: {
      contas: tabelaContas,
    },
    metricas: {
      burnRate,
      ticketMedio,
      margemContribuicao,
      pontoAtencao,
    },
  };
}

module.exports = {
  getAnalytics,
  getEvolucaoChart,
  getComposicaoDespesas,
  getDistribuicaoReceitas,
  getRankingProjetos,
  getTabelaContas,
  calcularBurnRate,
  calcularTicketMedio,
  calcularMargemContribuicao,
  encontrarPontoAtencao,
};

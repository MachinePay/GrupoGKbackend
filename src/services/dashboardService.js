const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

function getContaAccessFilter(user) {
  if (!user || user.perfil !== "CAIXA") {
    return {};
  }

  const contaIds = Array.isArray(user.contaBancariaIds)
    ? user.contaBancariaIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : user.contaBancariaId
      ? [Number(user.contaBancariaId)]
      : [];

  if (!contaIds.length) {
    throw new AppError(
      "Usuario CAIXA sem contas autorizadas. Contate um administrador.",
      403,
    );
  }

  return { id: { in: contaIds } };
}

/**
 * Extrai um valor decimal agregado retornando zero quando nulo.
 * @param {import("@prisma/client").Prisma.Decimal | null | undefined} value Valor agregado.
 * @returns {number}
 */
function decimalToNumber(value) {
  return value ? Number(value.toString()) : 0;
}

/**
 * Busca o consolidado financeiro do grupo desconsiderando transferencias no resultado.
 * @returns {Promise<object>}
 */
async function getConsolidatedDashboard(user) {
  const contaWhere = getContaAccessFilter(user);
  const [entradas, saidas, contas] = await Promise.all([
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: {
        tipo: "ENTRADA",
        status: "REALIZADO",
        ...(contaWhere.id ? { contaDestinoId: contaWhere.id } : {}),
      },
    }),
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: {
        tipo: "SAIDA",
        status: "REALIZADO",
        ...(contaWhere.id ? { contaOrigemId: contaWhere.id } : {}),
      },
    }),
    prisma.contaBancaria.findMany({
      where: contaWhere,
      select: { saldoAtual: true },
    }),
  ]);

  const totalEntradas = decimalToNumber(entradas._sum.valor);
  const totalSaidas = decimalToNumber(saidas._sum.valor);
  const saldoConsolidado = contas.reduce(
    (sum, conta) => sum + decimalToNumber(conta.saldoAtual),
    0,
  );

  return {
    totalEntradas,
    totalSaidas,
    saldoLiquido: saldoConsolidado,
  };
}

/**
 * Retorna o painel financeiro de uma empresa especifica.
 * Contas bancarias sao globais e compartilhadas entre empresas.
 * @param {number} empresaId Identificador da empresa.
 * @returns {Promise<object>}
 */
async function getEmpresaDashboard(empresaId, user) {
  const contaWhere = getContaAccessFilter(user);
  const [empresa, contasGlobais] = await Promise.all([
    prisma.empresa.findUnique({
      where: { id: Number(empresaId) },
      include: {
        projetos: {
          include: {
            _count: {
              select: {
                movimentacoes: true,
              },
            },
          },
          orderBy: { nome: "asc" },
        },
      },
    }),
    prisma.contaBancaria.findMany({
      where: contaWhere,
      orderBy: [{ banco: "asc" }, { nome: "asc" }],
    }),
  ]);

  if (!empresa) {
    throw new AppError("Empresa nao encontrada.", 404);
  }

  const [entradas, saidas, transferencias] = await Promise.all([
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: { empresaId: empresa.id, tipo: "ENTRADA", status: "REALIZADO" },
    }),
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: { empresaId: empresa.id, tipo: "SAIDA", status: "REALIZADO" },
    }),
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: {
        empresaId: empresa.id,
        tipo: "TRANSFERENCIA",
        status: "REALIZADO",
      },
    }),
  ]);

  const totalEntradas = decimalToNumber(entradas._sum.valor);
  const totalSaidas = decimalToNumber(saidas._sum.valor);

  return {
    empresa: {
      id: empresa.id,
      nome: empresa.nome,
    },
    totalEntradas,
    totalSaidas,
    saldoLiquido: totalEntradas - totalSaidas,
    fluxoTransferencias: decimalToNumber(transferencias._sum.valor),
    contas: contasGlobais,
    projetos: empresa.projetos,
  };
}

/**
 * Lista os saldos das contas bancarias do grupo.
 * @returns {Promise<object[]>}
 */
async function getContasDashboard(user) {
  const contaWhere = getContaAccessFilter(user);
  const contas = await prisma.contaBancaria.findMany({
    where: contaWhere,
    orderBy: [{ banco: "asc" }, { nome: "asc" }],
  });

  return contas.map((conta) => ({
    id: conta.id,
    nome: conta.nome,
    banco: conta.banco,
    saldoAtual: decimalToNumber(conta.saldoAtual),
  }));
}

/**
 * Consolida saldos por banco para o dashboard.
 * @returns {Promise<object[]>}
 */
async function getBancosDashboard(user) {
  const contaWhere = getContaAccessFilter(user);
  const contas = await prisma.contaBancaria.findMany({
    where: contaWhere,
    orderBy: [{ banco: "asc" }, { nome: "asc" }],
  });

  const grouped = new Map();

  for (const conta of contas) {
    const banco = conta.banco;
    const saldo = decimalToNumber(conta.saldoAtual);

    if (!grouped.has(banco)) {
      grouped.set(banco, {
        banco,
        saldoTotal: 0,
        contas: [],
      });
    }

    const bucket = grouped.get(banco);
    bucket.saldoTotal += saldo;
    bucket.contas.push({
      id: conta.id,
      nome: conta.nome,
      saldoAtual: saldo,
    });
  }

  return Array.from(grouped.values()).map((bucket) => ({
    banco: bucket.banco,
    saldoTotal: bucket.saldoTotal,
    contas: bucket.contas,
    participacaoPorEmpresa: [],
  }));
}

/**
 * Ranking financeiro dos projetos da MaisQuiosque.
 * @returns {Promise<object[]>}
 */
async function getMaisQuiosqueProjetosDashboard() {
  const empresa = await prisma.empresa.findUnique({
    where: { nome: "MaisQuiosque" },
  });

  if (!empresa) {
    return [];
  }

  const projetos = await prisma.projeto.findMany({
    where: { empresaId: empresa.id },
    orderBy: { nome: "asc" },
  });

  const ranking = await Promise.all(
    projetos.map(async (projeto) => {
      const [entradas, saidas] = await Promise.all([
        prisma.movimentacao.aggregate({
          _sum: { valor: true },
          where: {
            projetoId: projeto.id,
            tipo: "ENTRADA",
            status: "REALIZADO",
          },
        }),
        prisma.movimentacao.aggregate({
          _sum: { valor: true },
          where: {
            projetoId: projeto.id,
            tipo: "SAIDA",
            status: "REALIZADO",
          },
        }),
      ]);

      const totalEntradas = decimalToNumber(entradas._sum.valor);
      const totalSaidas = decimalToNumber(saidas._sum.valor);

      return {
        id: projeto.id,
        nome: projeto.nome,
        totalEntradas,
        totalSaidas,
        saldoLiquido: totalEntradas - totalSaidas,
      };
    }),
  );

  return ranking.sort((a, b) => b.saldoLiquido - a.saldoLiquido);
}

module.exports = {
  getBancosDashboard,
  getConsolidatedDashboard,
  getContasDashboard,
  getEmpresaDashboard,
  getMaisQuiosqueProjetosDashboard,
};

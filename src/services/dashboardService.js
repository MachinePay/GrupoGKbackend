const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

/**
 * Extrai um valor decimal agregado retornando zero quando nulo.
 * @param {Prisma.Decimal | null | undefined} value Valor agregado.
 * @returns {number}
 */
function decimalToNumber(value) {
  return value ? Number(value.toString()) : 0;
}

/**
 * Busca o consolidado financeiro do grupo desconsiderando transferencias no resultado.
 * @returns {Promise<object>}
 */
async function getConsolidatedDashboard() {
  const [entradas, saidas] = await Promise.all([
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: { tipo: "ENTRADA", status: "REALIZADO" },
    }),
    prisma.movimentacao.aggregate({
      _sum: { valor: true },
      where: { tipo: "SAIDA", status: "REALIZADO" },
    }),
  ]);

  const totalEntradas = decimalToNumber(entradas._sum.valor);
  const totalSaidas = decimalToNumber(saidas._sum.valor);

  return {
    totalEntradas,
    totalSaidas,
    saldoLiquido: totalEntradas - totalSaidas,
  };
}

/**
 * Retorna o painel financeiro de uma empresa especifica.
 * @param {number} empresaId Identificador da empresa.
 * @returns {Promise<object>}
 */
async function getEmpresaDashboard(empresaId) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: Number(empresaId) },
    include: {
      contasBancarias: {
        orderBy: { nome: "asc" },
      },
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
  });

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
    contas: empresa.contasBancarias,
    projetos: empresa.projetos,
  };
}

/**
 * Lista os saldos das contas bancarias do grupo.
 * @returns {Promise<object[]>}
 */
async function getContasDashboard() {
  const contas = await prisma.contaBancaria.findMany({
    include: {
      empresa: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
    orderBy: [{ banco: "asc" }, { nome: "asc" }],
  });

  return contas.map((conta) => ({
    id: conta.id,
    nome: conta.nome,
    banco: conta.banco,
    saldoAtual: decimalToNumber(conta.saldoAtual),
    empresa: conta.empresa,
  }));
}

/**
 * Consolida a participacao de cada empresa por banco.
 * @returns {Promise<object[]>}
 */
async function getBancosDashboard() {
  const contas = await prisma.contaBancaria.findMany({
    include: {
      empresa: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
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
        participacaoPorEmpresa: new Map(),
      });
    }

    const bucket = grouped.get(banco);
    bucket.saldoTotal += saldo;
    bucket.contas.push({
      id: conta.id,
      nome: conta.nome,
      saldoAtual: saldo,
      empresa: conta.empresa,
    });
    bucket.participacaoPorEmpresa.set(
      conta.empresa.nome,
      (bucket.participacaoPorEmpresa.get(conta.empresa.nome) || 0) + saldo,
    );
  }

  return Array.from(grouped.values()).map((bucket) => ({
    banco: bucket.banco,
    saldoTotal: bucket.saldoTotal,
    contas: bucket.contas,
    participacaoPorEmpresa: Array.from(bucket.participacaoPorEmpresa.entries())
      .map(([empresa, saldo]) => ({
        empresa,
        saldo,
        percentual:
          bucket.saldoTotal > 0
            ? Number(((saldo / bucket.saldoTotal) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.saldo - a.saldo),
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

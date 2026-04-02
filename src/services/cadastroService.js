const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

/**
 * Converte valores para Decimal do Prisma.
 * @param {number | string} value Valor bruto.
 * @returns {Prisma.Decimal}
 */
function toDecimal(value) {
  return new Prisma.Decimal(value);
}

/**
 * Lista empresas cadastradas.
 * @returns {Promise<object[]>}
 */
async function listEmpresas() {
  return prisma.empresa.findMany({ orderBy: { nome: "asc" } });
}

/**
 * Cria uma nova empresa.
 * @param {{ nome: string }} payload Dados da empresa.
 * @returns {Promise<object>}
 */
async function createEmpresa(payload) {
  return prisma.empresa.create({
    data: {
      nome: payload.nome.trim(),
    },
  });
}

/**
 * Atualiza o nome de uma empresa.
 * @param {number | string} id Identificador da empresa.
 * @param {{ nome: string }} payload Dados da empresa.
 * @returns {Promise<object>}
 */
async function updateEmpresa(id, payload) {
  const empresaId = Number(id);

  const existing = await prisma.empresa.findUnique({
    where: { id: empresaId },
  });

  if (!existing) {
    throw new AppError("Empresa nao encontrada.", 404);
  }

  return prisma.empresa.update({
    where: { id: empresaId },
    data: {
      nome: payload.nome.trim(),
    },
  });
}

/**
 * Remove uma empresa sem vinculos operacionais.
 * @param {number | string} id Identificador da empresa.
 * @returns {Promise<void>}
 */
async function deleteEmpresa(id) {
  const empresaId = Number(id);

  const existing = await prisma.empresa.findUnique({
    where: { id: empresaId },
  });

  if (!existing) {
    throw new AppError("Empresa nao encontrada.", 404);
  }

  const [contasCount, projetosCount, movimentacoesCount, agendaCount] =
    await Promise.all([
      prisma.contaBancaria.count({ where: { empresaId } }),
      prisma.projeto.count({ where: { empresaId } }),
      prisma.movimentacao.count({ where: { empresaId } }),
      prisma.agenda.count({ where: { empresaId } }),
    ]);

  if (
    contasCount > 0 ||
    projetosCount > 0 ||
    movimentacoesCount > 0 ||
    agendaCount > 0
  ) {
    throw new AppError(
      "Nao e possivel excluir empresa com contas, projetos, movimentacoes ou agenda vinculados.",
      409,
    );
  }

  await prisma.empresa.delete({
    where: { id: empresaId },
  });
}

/**
 * Lista contas bancarias com filtro opcional por empresa.
 * @param {{ empresaId?: string }} query Parametros de consulta.
 * @returns {Promise<object[]>}
 */
async function listContas(query) {
  const where = query.empresaId
    ? { empresaId: Number(query.empresaId) }
    : undefined;

  return prisma.contaBancaria.findMany({
    where,
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
}

/**
 * Cria uma conta bancaria para uma empresa.
 * @param {{ nome: string, banco: string, empresaId: number, saldoAtual?: number | string }} payload Dados da conta.
 * @returns {Promise<object>}
 */
async function createConta(payload) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: Number(payload.empresaId) },
  });

  if (!empresa) {
    throw new AppError("Empresa nao encontrada para vincular a conta.", 404);
  }

  return prisma.contaBancaria.create({
    data: {
      nome: payload.nome.trim(),
      banco: payload.banco.trim(),
      saldoAtual:
        payload.saldoAtual !== undefined
          ? toDecimal(payload.saldoAtual)
          : toDecimal(0),
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
 * Lista projetos com filtro opcional por empresa.
 * @param {{ empresaId?: string }} query Parametros de consulta.
 * @returns {Promise<object[]>}
 */
async function listProjetos(query) {
  const where = query.empresaId
    ? { empresaId: Number(query.empresaId) }
    : undefined;

  return prisma.projeto.findMany({
    where,
    include: {
      empresa: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
    orderBy: { nome: "asc" },
  });
}

/**
 * Cria projeto vinculado a empresa.
 * @param {{ nome: string, empresaId: number }} payload Dados do projeto.
 * @returns {Promise<object>}
 */
async function createProjeto(payload) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: Number(payload.empresaId) },
  });

  if (!empresa) {
    throw new AppError("Empresa nao encontrada para vincular o projeto.", 404);
  }

  return prisma.projeto.create({
    data: {
      nome: payload.nome.trim(),
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

module.exports = {
  createConta,
  createEmpresa,
  createProjeto,
  deleteEmpresa,
  listContas,
  listEmpresas,
  listProjetos,
  updateEmpresa,
};

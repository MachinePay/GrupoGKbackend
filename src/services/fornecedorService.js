const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

/**
 * Lista fornecedores com opção de filtro por ativo.
 * @param {boolean | undefined} ativo - Se true, lista só ativos; se false, só inativos; se undefined, todos.
 * @returns {Promise<object[]>}
 */
async function getFornecedores(ativo) {
  const where = ativo !== undefined ? { ativo } : {};

  return prisma.fornecedor.findMany({
    where,
    orderBy: { nome: "asc" },
  });
}

/**
 * Cria um novo fornecedor.
 * @param {{ nome: string, descricao?: string }} payload Dados do fornecedor.
 * @returns {Promise<object>}
 */
async function createFornecedor(payload) {
  // Validar se já existe fornecedor com este nome
  const existing = await prisma.fornecedor.findUnique({
    where: { nome: payload.nome.trim() },
  });

  if (existing) {
    throw new AppError(
      `Fornecedor "${payload.nome}" já existe no sistema.`,
      400,
    );
  }

  return prisma.fornecedor.create({
    data: {
      nome: payload.nome.trim(),
      descricao: payload.descricao?.trim() || null,
      ativo: true,
    },
  });
}

/**
 * Atualiza um fornecedor existente.
 * @param {number | string} fornecedorId Identificador do fornecedor.
 * @param {{ nome?: string, descricao?: string }} payload Dados a atualizar.
 * @returns {Promise<object>}
 */
async function updateFornecedor(fornecedorId, payload) {
  const fornecedor = await prisma.fornecedor.findUnique({
    where: { id: Number(fornecedorId) },
  });

  if (!fornecedor) {
    throw new AppError("Fornecedor não encontrado.", 404);
  }

  // Se está atualizando o nome, validar duplicação
  if (payload.nome && payload.nome.trim() !== fornecedor.nome) {
    const existing = await prisma.fornecedor.findUnique({
      where: { nome: payload.nome.trim() },
    });

    if (existing) {
      throw new AppError(
        `Fornecedor "${payload.nome}" já existe no sistema.`,
        400,
      );
    }
  }

  return prisma.fornecedor.update({
    where: { id: Number(fornecedorId) },
    data: {
      ...(payload.nome && { nome: payload.nome.trim() }),
      ...(payload.descricao !== undefined && {
        descricao: payload.descricao?.trim() || null,
      }),
    },
  });
}

/**
 * Alterna o status ativo/inativo de um fornecedor.
 * @param {number | string} fornecedorId Identificador do fornecedor.
 * @returns {Promise<object>}
 */
async function toggleFornecedor(fornecedorId) {
  const fornecedor = await prisma.fornecedor.findUnique({
    where: { id: Number(fornecedorId) },
  });

  if (!fornecedor) {
    throw new AppError("Fornecedor não encontrado.", 404);
  }

  return prisma.fornecedor.update({
    where: { id: Number(fornecedorId) },
    data: { ativo: !fornecedor.ativo },
  });
}

/**
 * Exclui um fornecedor.
 * @param {number | string} fornecedorId Identificador do fornecedor.
 * @returns {Promise<object>}
 */
async function deleteFornecedor(fornecedorId) {
  const fornecedor = await prisma.fornecedor.findUnique({
    where: { id: Number(fornecedorId) },
  });

  if (!fornecedor) {
    throw new AppError("Fornecedor não encontrado.", 404);
  }

  // Verificar se há agenda vinculada a este fornecedor
  const agendaCount = await prisma.agenda.count({
    where: { fornecedorId: Number(fornecedorId) },
  });

  if (agendaCount > 0) {
    throw new AppError(
      `Não é possível excluir este fornecedor pois há ${agendaCount} compromisso(s) vinculado(s).`,
      400,
    );
  }

  return prisma.fornecedor.delete({
    where: { id: Number(fornecedorId) },
    select: {
      id: true,
      nome: true,
    },
  });
}

module.exports = {
  getFornecedores,
  createFornecedor,
  updateFornecedor,
  toggleFornecedor,
  deleteFornecedor,
};

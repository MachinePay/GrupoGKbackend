const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const bcrypt = require("bcryptjs");

/**
 * Lista usuários com filtros opcionais.
 * @param {object} filters Filtros opcionais.
 * @returns {Promise<Array>}
 */
async function listarUsuarios(filters = {}) {
  const where = {
    ...(filters.perfil ? { perfil: filters.perfil } : {}),
    ...(filters.contaBancariaId
      ? { contaBancariaId: Number(filters.contaBancariaId) }
      : {}),
  };

  const usuarios = await prisma.usuario.findMany({
    where,
    select: {
      id: true,
      nome: true,
      email: true,
      perfil: true,
      ativo: true,
      contaBancariaId: true,
      contaBancaria: {
        select: {
          id: true,
          banco: true,
          nome: true,
        },
      },
      ultimoLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return usuarios;
}

/**
 * Cria novo usuário com validações de acesso.
 * @param {object} payload Dados do usuário.
 * @param {string} payload.nome Nome do usuário.
 * @param {string} payload.email Email único.
 * @param {string} payload.senha Senha temporária.
 * @param {string} payload.perfil ADMIN | FINANCEIRO | CAIXA.
 * @param {number|null} payload.contaBancariaId Conta restrita (para CAIXA).
 * @returns {Promise<object>}
 */
async function criarUsuario(payload) {
  const { nome, email, senha, perfil, contaBancariaId } = payload;

  if (!nome || !email || !senha || !perfil) {
    throw new AppError("Nome, email, senha e perfil são obrigatórios.", 400);
  }

  const perfilValido = ["ADMIN", "FINANCEIRO", "CAIXA"].includes(perfil);
  if (!perfilValido) {
    throw new AppError("Perfil inválido. Use ADMIN, FINANCEIRO ou CAIXA.", 400);
  }

  if (perfil === "CAIXA" && !contaBancariaId) {
    throw new AppError(
      "Usuários com perfil CAIXA exigem contaBancariaId.",
      400,
    );
  }

  if (perfil !== "CAIXA" && contaBancariaId) {
    throw new AppError("Apenas usuários CAIXA podem ter conta restrita.", 400);
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    throw new AppError("Usuário com este email já existe.", 409);
  }

  if (contaBancariaId) {
    const conta = await prisma.contaBancaria.findUnique({
      where: { id: Number(contaBancariaId) },
    });
    if (!conta) {
      throw new AppError("Conta bancária não encontrada.", 404);
    }
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await prisma.usuario.create({
    data: {
      nome,
      email,
      senhaHash,
      perfil,
      contaBancariaId: contaBancariaId ? Number(contaBancariaId) : null,
    },
    select: {
      id: true,
      nome: true,
      email: true,
      perfil: true,
      ativo: true,
      contaBancariaId: true,
      contaBancaria: {
        select: {
          id: true,
          banco: true,
          nome: true,
        },
      },
      createdAt: true,
    },
  });

  return usuario;
}

/**
 * Atualiza dados de um usuário.
 * @param {number} usuarioId ID do usuário.
 * @param {object} payload Dados a atualizar.
 * @returns {Promise<object>}
 */
async function atualizarUsuario(usuarioId, payload) {
  const { nome, perfil, ativo, contaBancariaId } = payload;

  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(usuarioId) },
  });

  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  if (perfil && !["ADMIN", "FINANCEIRO", "CAIXA"].includes(perfil)) {
    throw new AppError("Perfil inválido.", 400);
  }

  if (contaBancariaId) {
    const conta = await prisma.contaBancaria.findUnique({
      where: { id: Number(contaBancariaId) },
    });
    if (!conta) {
      throw new AppError("Conta bancária não encontrada.", 404);
    }
  }

  const atualizado = await prisma.usuario.update({
    where: { id: Number(usuarioId) },
    data: {
      ...(nome ? { nome } : {}),
      ...(perfil ? { perfil } : {}),
      ...(ativo !== undefined ? { ativo } : {}),
      ...(contaBancariaId !== undefined
        ? { contaBancariaId: contaBancariaId ? Number(contaBancariaId) : null }
        : {}),
    },
    select: {
      id: true,
      nome: true,
      email: true,
      perfil: true,
      ativo: true,
      contaBancariaId: true,
      contaBancaria: {
        select: {
          id: true,
          banco: true,
          nome: true,
        },
      },
      ultimoLoginAt: true,
      createdAt: true,
    },
  });

  return atualizado;
}

/**
 * Deleta um usuário.
 * @param {number} usuarioId ID do usuário.
 * @returns {Promise<{id: number}>}
 */
async function deletarUsuario(usuarioId) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(usuarioId) },
  });

  if (!usuario) {
    throw new AppError("Usuário não encontrado.", 404);
  }

  await prisma.usuario.delete({
    where: { id: Number(usuarioId) },
  });

  return { id: Number(usuarioId) };
}

module.exports = {
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  deletarUsuario,
};

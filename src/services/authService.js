const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const env = require("../config/env");
const AppError = require("../middlewares/appError");

/**
 * Remove campos sensiveis do usuario.
 * @param {import("@prisma/client").Usuario} usuario Registro do banco.
 * @returns {{ id: number, nome: string, email: string, perfil: string, tema: string, ativo: boolean, ultimoLoginAt: Date | null, createdAt: Date, updatedAt: Date }}
 */
function sanitizeUser(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    tema: usuario.tema,
    ativo: usuario.ativo,
    ultimoLoginAt: usuario.ultimoLoginAt,
    createdAt: usuario.createdAt,
    updatedAt: usuario.updatedAt,
  };
}

/**
 * Emite token JWT para o usuario autenticado.
 * @param {{ id: number, email: string, perfil: string }} user Dados minimos para token.
 * @returns {string}
 */
function generateToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      perfil: user.perfil,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

/**
 * Sincroniza usuario admin padrao com variaveis de ambiente para recuperacao de acesso.
 * @param {string} email Email informado no login.
 * @returns {Promise<void>}
 */
async function syncSeedAdminForLogin(email) {
  const seedEmail = String(process.env.SEED_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  const seedNome = (process.env.SEED_ADMIN_NOME || "Administrador").trim();

  if (!seedEmail || !seedPassword || email !== seedEmail) {
    return;
  }

  const senhaHash = await bcrypt.hash(seedPassword, 10);

  await prisma.usuario.upsert({
    where: { email: seedEmail },
    update: {
      nome: seedNome,
      senhaHash,
      perfil: "ADMIN",
      ativo: true,
    },
    create: {
      nome: seedNome,
      email: seedEmail,
      senhaHash,
      perfil: "ADMIN",
      ativo: true,
    },
  });
}

/**
 * Cria novo usuario por fluxo administrativo.
 * @param {{ nome: string, email: string, senha: string, perfil?: "ADMIN" | "FINANCEIRO" }} payload Dados do usuario.
 * @returns {Promise<object>}
 */
async function createUser(payload) {
  const email = payload.email.trim().toLowerCase();

  const existing = await prisma.usuario.findUnique({ where: { email } });

  if (existing) {
    throw new AppError("Email ja cadastrado.", 409);
  }

  const senhaHash = await bcrypt.hash(payload.senha, 10);

  const usuario = await prisma.usuario.create({
    data: {
      nome: payload.nome.trim(),
      email,
      senhaHash,
      perfil: payload.perfil || "FINANCEIRO",
      ativo: true,
    },
  });

  return sanitizeUser(usuario);
}

/**
 * Realiza login de usuario por email e senha.
 * @param {{ email: string, senha: string }} payload Credenciais de login.
 * @returns {Promise<object>}
 */
async function login(payload) {
  const email = payload.email.trim().toLowerCase();

  await syncSeedAdminForLogin(email);

  const usuario = await prisma.usuario.findUnique({ where: { email } });

  if (!usuario) {
    throw new AppError("Credenciais invalidas.", 401);
  }

  if (!usuario.ativo) {
    throw new AppError("Usuario inativo.", 403);
  }

  const validPassword = await bcrypt.compare(payload.senha, usuario.senhaHash);

  if (!validPassword) {
    throw new AppError("Credenciais invalidas.", 401);
  }

  const updatedUser = await prisma.usuario.update({
    where: { id: usuario.id },
    data: { ultimoLoginAt: new Date() },
  });

  const token = generateToken(updatedUser);

  return {
    usuario: sanitizeUser(updatedUser),
    token,
  };
}

/**
 * Retorna dados do usuario autenticado.
 * @param {number} userId Identificador do usuario.
 * @returns {Promise<object>}
 */
async function getMe(userId) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(userId) },
  });

  if (!usuario) {
    throw new AppError("Usuario nao encontrado.", 404);
  }

  return sanitizeUser(usuario);
}

/**
 * Lista todos os usuarios cadastrados.
 * @returns {Promise<object[]>}
 */
async function listUsers() {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { createdAt: "asc" },
  });

  return usuarios.map(sanitizeUser);
}

/**
 * Alterna o status ativo/inativo de um usuario.
 * @param {number} userId Identificador do usuario a ser alterado.
 * @param {number} requesterId Identificador do usuario que faz o pedido.
 * @returns {Promise<object>}
 */
async function toggleUserStatus(userId, requesterId) {
  if (Number(userId) === Number(requesterId)) {
    throw new AppError("Nao e possivel inativar o proprio usuario.", 400);
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(userId) },
  });

  if (!usuario) {
    throw new AppError("Usuario nao encontrado.", 404);
  }

  const updated = await prisma.usuario.update({
    where: { id: Number(userId) },
    data: { ativo: !usuario.ativo },
  });

  return sanitizeUser(updated);
}

/**
 * Altera a senha do proprio usuario autenticado.
 * @param {number} userId Identificador do usuario.
 * @param {{ senhaAtual: string, novaSenha: string }} payload Senhas.
 * @returns {Promise<void>}
 */
async function changePassword(userId, payload) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(userId) },
  });

  if (!usuario) {
    throw new AppError("Usuario nao encontrado.", 404);
  }

  const validPassword = await bcrypt.compare(
    payload.senhaAtual,
    usuario.senhaHash,
  );

  if (!validPassword) {
    throw new AppError("Senha atual incorreta.", 401);
  }

  const novaSenhaHash = await bcrypt.hash(payload.novaSenha, 10);

  await prisma.usuario.update({
    where: { id: Number(userId) },
    data: { senhaHash: novaSenhaHash },
  });
}

/**
 * Atualiza a preferencia de tema do usuario autenticado.
 * @param {number} userId Identificador do usuario.
 * @param {{ tema: "LIGHT" | "DARK" }} payload Dados do tema.
 * @returns {Promise<object>}
 */
async function updateTheme(userId, payload) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(userId) },
  });

  if (!usuario) {
    throw new AppError("Usuario nao encontrado.", 404);
  }

  const updated = await prisma.usuario.update({
    where: { id: Number(userId) },
    data: { tema: payload.tema },
  });

  return sanitizeUser(updated);
}

module.exports = {
  changePassword,
  createUser,
  getMe,
  listUsers,
  login,
  toggleUserStatus,
  updateTheme,
};

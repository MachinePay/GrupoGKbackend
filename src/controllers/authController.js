const authService = require("../services/authService");

/**
 * Cria usuario por fluxo administrativo.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createUser(req, res, next) {
  try {
    const data = await authService.createUser(req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Realiza login de usuario.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function login(req, res, next) {
  try {
    const data = await authService.login(req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Retorna usuario autenticado.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function me(req, res, next) {
  try {
    const data = await authService.getMe(req.user.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Lista todos os usuarios (somente ADMIN).
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function listUsers(_req, res, next) {
  try {
    const data = await authService.listUsers();
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Ativa ou inativa um usuario (somente ADMIN).
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function toggleUserStatus(req, res, next) {
  try {
    const data = await authService.toggleUserStatus(req.params.id, req.user.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Troca a senha do proprio usuario autenticado.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function changePassword(req, res, next) {
  try {
    await authService.changePassword(req.user.id, req.body);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza o tema do proprio usuario autenticado.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function updateTheme(req, res, next) {
  try {
    const data = await authService.updateTheme(req.user.id, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  changePassword,
  createUser,
  listUsers,
  login,
  me,
  toggleUserStatus,
  updateTheme,
};

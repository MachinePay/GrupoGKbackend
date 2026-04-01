const cadastroService = require("../services/cadastroService");

/**
 * Lista empresas.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function listEmpresas(_req, res, next) {
  try {
    const data = await cadastroService.listEmpresas();
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria empresa.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createEmpresa(req, res, next) {
  try {
    const data = await cadastroService.createEmpresa(req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Lista contas bancarias.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function listContas(req, res, next) {
  try {
    const data = await cadastroService.listContas(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria conta bancaria.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createConta(req, res, next) {
  try {
    const data = await cadastroService.createConta(req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Lista projetos.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function listProjetos(req, res, next) {
  try {
    const data = await cadastroService.listProjetos(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria projeto.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createProjeto(req, res, next) {
  try {
    const data = await cadastroService.createProjeto(req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createConta,
  createEmpresa,
  createProjeto,
  listContas,
  listEmpresas,
  listProjetos,
};

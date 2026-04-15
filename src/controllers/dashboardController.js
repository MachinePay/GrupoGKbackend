const dashboardService = require("../services/dashboardService");

/**
 * Retorna o consolidado do grupo.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getConsolidatedDashboard(req, res, next) {
  try {
    const data = await dashboardService.getConsolidatedDashboard(req.user);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Retorna o dashboard financeiro de uma empresa.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getEmpresaDashboard(req, res, next) {
  try {
    const data = await dashboardService.getEmpresaDashboard(
      req.params.id,
      req.user,
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Retorna os saldos das contas bancarias.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getContasDashboard(req, res, next) {
  try {
    const data = await dashboardService.getContasDashboard(req.user);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Retorna consolidado por banco com participacao por empresa.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getBancosDashboard(req, res, next) {
  try {
    const data = await dashboardService.getBancosDashboard(req.user);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Retorna o ranking dos projetos da MaisQuiosque.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getMaisQuiosqueProjetosDashboard(_req, res, next) {
  try {
    const data = await dashboardService.getMaisQuiosqueProjetosDashboard();
    res.json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBancosDashboard,
  getConsolidatedDashboard,
  getContasDashboard,
  getEmpresaDashboard,
  getMaisQuiosqueProjetosDashboard,
};

const cotacaoService = require("../services/cotacaoService");

/**
 * Lista as cotacoes de moedas em reais.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getCotacoes(_req, res, next) {
  try {
    res.json(await cotacaoService.getCotacoes());
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza as cotacoes de moedas.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function updateCotacoes(req, res, next) {
  try {
    res.json(await cotacaoService.updateCotacoes(req.body));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCotacoes,
  updateCotacoes,
};

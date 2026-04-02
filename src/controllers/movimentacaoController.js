const movimentacaoService = require("../services/movimentacaoService");

/**
 * Cria uma nova movimentacao financeira.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createMovimentacao(req, res, next) {
  try {
    const movimentacao = await movimentacaoService.createMovimentacao(req.body);
    res.status(201).json(movimentacao);
  } catch (error) {
    next(error);
  }
}

/**
 * Lista historico de movimentacoes com filtros opcionais.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function listMovimentacoes(req, res, next) {
  try {
    const response = await movimentacaoService.listMovimentacoes(req.query);
    res.json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Exclui uma movimentacao prevista.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function deleteMovimentacao(req, res, next) {
  try {
    const response = await movimentacaoService.deleteMovimentacao(
      req.params.id,
    );
    res.json(response);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createMovimentacao,
  deleteMovimentacao,
  listMovimentacoes,
};

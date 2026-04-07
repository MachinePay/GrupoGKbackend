const relatoriosService = require("../services/relatoriosService");

/**
 * Retorna dados completos de analytics com filtros
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getAnalytics(req, res, next) {
  try {
    const filtros = {
      empresaId: req.query.empresaId,
      contaId: req.query.contaId,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      groupBy: req.query.groupBy || "dia",
    };

    const dados = await relatoriosService.getAnalytics(filtros);
    res.json(dados);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAnalytics,
};

const agendaService = require("../services/agendaService");

/**
 * Lista os itens da agenda financeira.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getAgendaItems(req, res, next) {
  try {
    const data = await agendaService.getAgendaItems(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Lista o historico de baixas da agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getAgendaSettlementHistory(req, res, next) {
  try {
    const data = await agendaService.getAgendaSettlementHistory(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria item de agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createAgendaItem(req, res, next) {
  try {
    const usuarioId = req.user?.id;
    const data = await agendaService.createAgendaItem(req.body, usuarioId);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza item de agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function updateAgendaItem(req, res, next) {
  try {
    const data = await agendaService.updateAgendaItem(req.params.id, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Exclui item de agenda nao realizado.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function deleteAgendaItem(req, res, next) {
  try {
    const data = await agendaService.deleteAgendaItem(req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Realiza a baixa de um item da agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function settleAgendaItem(req, res, next) {
  try {
    const data = await agendaService.settleAgendaItem(req.params.id, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createAgendaItem,
  deleteAgendaItem,
  getAgendaSettlementHistory,
  getAgendaItems,
  settleAgendaItem,
  updateAgendaItem,
};

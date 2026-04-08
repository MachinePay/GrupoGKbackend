const fornecedorService = require("../services/fornecedorService");

/**
 * Lista todos os fornecedores com opção de filtro por ativo/inativo.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function getFornecedores(req, res, next) {
  try {
    const { ativo } = req.query;
    const data = await fornecedorService.getFornecedores(
      ativo !== undefined ? ativo === "true" : undefined,
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria um novo fornecedor.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function createFornecedor(req, res, next) {
  try {
    const data = await fornecedorService.createFornecedor(req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza um fornecedor existente.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function updateFornecedor(req, res, next) {
  try {
    const data = await fornecedorService.updateFornecedor(
      req.params.id,
      req.body,
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Alterna o status ativo/inativo de um fornecedor.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function toggleFornecedor(req, res, next) {
  try {
    const data = await fornecedorService.toggleFornecedor(req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Exclui um fornecedor.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {Promise<void>}
 */
async function deleteFornecedor(req, res, next) {
  try {
    const data = await fornecedorService.deleteFornecedor(req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getFornecedores,
  createFornecedor,
  updateFornecedor,
  toggleFornecedor,
  deleteFornecedor,
};

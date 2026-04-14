const selfMachineService = require("../services/selfMachineService");

/**
 * Lista contratos SaaS da SelfMachine.
 * @param {import("express").Request} _req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function listSaasContratos(_req, res, next) {
  try {
    console.log("[selfMachine] Iniciando listSaasContratos...");
    const data = await selfMachineService.listSaasContratos();
    console.log(`[selfMachine] Retornando ${data.length} contratos`);
    res.json(data);
  } catch (error) {
    console.error(
      "[selfMachine] Erro em listSaasContratos:",
      error.message,
      error.stack,
    );
    next(error);
  }
}

/**
 * Busca um contrato SaaS por id.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function getSaasContratoById(req, res, next) {
  try {
    const data = await selfMachineService.getSaasContratoById(req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Cria contrato SaaS.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function createSaasContrato(req, res, next) {
  try {
    const data = await selfMachineService.createSaasContrato(req.body);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Atualiza contrato SaaS.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function updateSaasContrato(req, res, next) {
  try {
    const data = await selfMachineService.updateSaasContrato(
      req.params.id,
      req.body,
    );
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Exclui contrato SaaS.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function deleteSaasContrato(req, res, next) {
  try {
    const data = await selfMachineService.deleteSaasContrato(req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Gera pedido de pagamento e atualiza status do mes.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function gerarPedidoPagamento(req, res, next) {
  try {
    const data = await selfMachineService.gerarPedidoPagamento(req.params.id);
    res.json(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listSaasContratos,
  getSaasContratoById,
  createSaasContrato,
  updateSaasContrato,
  deleteSaasContrato,
  gerarPedidoPagamento,
};

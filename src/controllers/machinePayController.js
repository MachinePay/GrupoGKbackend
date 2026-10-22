const machinePayService = require("../services/machinePayService");
const machinePayPainelService = require("../services/machinePayPainelService");
const sumupService = require("../services/sumupService");
const whatsappService = require("../services/whatsappService");

/**
 * Cria handler Express padrao para o service.
 * @param {(req: import("express").Request) => Promise<unknown>} fn
 * @param {number} status
 */
function handler(fn, status = 200) {
  return async (req, res, next) => {
    try {
      const data = await fn(req);
      if (data === undefined) {
        res.status(204).send();
        return;
      }
      res.status(status).json(data);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  getConfig: handler(() => machinePayService.getConfig()),
  updateConfig: handler((req) =>
    machinePayService.updateConfig(req.body, req.user),
  ),
  listClientes: handler(() => machinePayService.listClientes()),
  createCliente: handler(
    (req) => machinePayService.createCliente(req.body),
    201,
  ),
  updateCliente: handler((req) =>
    machinePayService.updateCliente(req.params.id, req.body, req.user),
  ),
  ajustarMaquinas: handler((req) =>
    machinePayService.ajustarMaquinas(req.params.id, req.body, req.user),
  ),
  deleteCliente: handler((req) =>
    machinePayService.deleteCliente(req.params.id),
  ),
  getHistoricoCliente: handler((req) =>
    machinePayService.getHistoricoCliente(req.params.id),
  ),
  importarClientes: handler(
    (req) => machinePayService.importarClientes(req.body?.clientes),
    201,
  ),
  getStatusPainel: handler(() =>
    machinePayPainelService.getStatusSincronizacao(),
  ),
  // A leitura completa do painel leva alguns minutos: dispara em segundo
  // plano e a tela acompanha por GET /painel/status.
  sincronizarPainel: handler(async () => {
    machinePayPainelService
      .sincronizarPainel({ origem: "manual" })
      .catch((error) => console.error("[machinepay] sync manual falhou:", error.message));
    return machinePayPainelService.getStatusSincronizacao();
  }, 202),
  getCompetencia: handler((req) =>
    machinePayService.getCompetencia(req.query.competencia),
  ),
  gerarCobrancas: handler(
    (req) => machinePayService.gerarCobrancas(req.body?.competencia),
    201,
  ),
  updateCobranca: handler((req) =>
    machinePayService.updateCobranca(req.params.id, req.body),
  ),
  pagarCobranca: handler((req) =>
    machinePayService.pagarCobranca(req.params.id, req.body, req.user),
  ),
  estornarCobranca: handler((req) =>
    machinePayService.alterarStatusCobranca(req.params.id, "PENDENTE"),
  ),
  cancelarCobranca: handler((req) =>
    machinePayService.alterarStatusCobranca(req.params.id, "CANCELADO"),
  ),
  deleteCobranca: handler((req) =>
    machinePayService.deleteCobranca(req.params.id),
  ),
  getEvolucao: handler((req) =>
    machinePayService.getEvolucao(req.query.meses),
  ),
  getConfigSumup: handler(() => sumupService.getConfig()),
  updateConfigSumup: handler((req) =>
    sumupService.updateConfig(req.body, req.user),
  ),
  testarSumup: handler((req) => sumupService.testarConexao(req.user)),
  gerarPix: handler(
    (req) => sumupService.gerarPix(req.params.id, { novo: Boolean(req.body?.novo) }),
    201,
  ),
  verificarPix: handler((req) => sumupService.verificarPix(req.params.id)),
  getConfigWhatsapp: handler(() => whatsappService.getConfig()),
  updateConfigWhatsapp: handler((req) =>
    whatsappService.updateConfig(req.body, req.user),
  ),
  getConexaoWhatsapp: handler(() => whatsappService.getConexao()),
  conectarWhatsapp: handler(() => whatsappService.conectar()),
  enviarWhatsapp: handler(
    (req) =>
      whatsappService.enfileirar(req.body?.ids, { reenviar: Boolean(req.body?.reenviar) }),
    202,
  ),
  getFilaWhatsapp: handler(() => whatsappService.getStatusFila()),
  cancelarFilaWhatsapp: handler(() => whatsappService.cancelarFila()),
  // Rota publica chamada pela SumUp: responde 200 logo e confere em seguida.
  webhookSumup: handler(async (req) => {
    await sumupService.receberWebhook(req.params.token, req.body);
    return { recebido: true };
  }),
};

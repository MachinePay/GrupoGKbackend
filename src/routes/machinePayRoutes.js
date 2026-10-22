const { Router } = require("express");
const machinePayController = require("../controllers/machinePayController");
const { authorize } = require("../middlewares/authMiddleware");

const router = Router();

router.get("/config", machinePayController.getConfig);
router.put("/config", machinePayController.updateConfig);

router.get("/painel/status", machinePayController.getStatusPainel);
router.post("/painel/sincronizar", machinePayController.sincronizarPainel);

router.get("/clientes", machinePayController.listClientes);
router.post("/clientes", machinePayController.createCliente);
router.post("/clientes/importar", machinePayController.importarClientes);
router.get("/clientes/:id/historico", machinePayController.getHistoricoCliente);
router.put("/clientes/:id", machinePayController.updateCliente);
router.post("/clientes/:id/maquinas", machinePayController.ajustarMaquinas);
router.delete("/clientes/:id", machinePayController.deleteCliente);

router.get("/cobrancas", machinePayController.getCompetencia);
router.get("/cobrancas/evolucao", machinePayController.getEvolucao);
router.post("/cobrancas/gerar", machinePayController.gerarCobrancas);
router.put("/cobrancas/:id", machinePayController.updateCobranca);
router.post("/cobrancas/:id/pagar", machinePayController.pagarCobranca);
router.post("/cobrancas/:id/estornar", machinePayController.estornarCobranca);
router.post("/cobrancas/:id/cancelar", machinePayController.cancelarCobranca);
router.delete("/cobrancas/:id", machinePayController.deleteCobranca);
router.post("/cobrancas/:id/pix", machinePayController.gerarPix);
router.post("/cobrancas/:id/pix/verificar", machinePayController.verificarPix);

// A chave da API da SumUp so e configurada por administradores.
router.get("/sumup/config", machinePayController.getConfigSumup);
router.put("/sumup/config", authorize("ADMIN"), machinePayController.updateConfigSumup);
router.post("/sumup/testar", authorize("ADMIN"), machinePayController.testarSumup);
router.post("/sumup/conferir", authorize("FINANCEIRO"), machinePayController.conferirPixPagos);

// WhatsApp (Evolution API): configurar e conectar o numero so administradores;
// enviar cobrancas, financeiro e administradores.
router.get("/whatsapp/config", machinePayController.getConfigWhatsapp);
router.put("/whatsapp/config", authorize("ADMIN"), machinePayController.updateConfigWhatsapp);
router.get("/whatsapp/conexao", machinePayController.getConexaoWhatsapp);
router.post("/whatsapp/conectar", authorize("ADMIN"), machinePayController.conectarWhatsapp);
router.get("/whatsapp/fila", machinePayController.getFilaWhatsapp);
router.post("/whatsapp/enviar", authorize("FINANCEIRO"), machinePayController.enviarWhatsapp);
router.post("/whatsapp/cancelar", authorize("FINANCEIRO"), machinePayController.cancelarFilaWhatsapp);

module.exports = router;

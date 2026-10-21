const { Router } = require("express");
const machinePayController = require("../controllers/machinePayController");

const router = Router();

router.get("/config", machinePayController.getConfig);
router.put("/config", machinePayController.updateConfig);

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

module.exports = router;

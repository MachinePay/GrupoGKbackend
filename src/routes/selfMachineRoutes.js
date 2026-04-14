const { Router } = require("express");
const selfMachineController = require("../controllers/selfMachineController");

const router = Router();

router.get("/saas/relatorio", selfMachineController.getRelatorio);
router.get("/saas", selfMachineController.listSaasContratos);
router.get("/saas/:id", selfMachineController.getSaasContratoById);
router.post("/saas", selfMachineController.createSaasContrato);
router.put("/saas/:id", selfMachineController.updateSaasContrato);
router.delete("/saas/:id", selfMachineController.deleteSaasContrato);
router.post(
  "/saas/:id/gerar-pedido",
  selfMachineController.gerarPedidoPagamento,
);

module.exports = router;

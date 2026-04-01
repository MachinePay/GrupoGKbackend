const { Router } = require("express");
const dashboardController = require("../controllers/dashboardController");

const router = Router();

router.get("/consolidado", dashboardController.getConsolidatedDashboard);
router.get("/empresa/:id", dashboardController.getEmpresaDashboard);
router.get("/contas", dashboardController.getContasDashboard);
router.get("/bancos", dashboardController.getBancosDashboard);
router.get(
  "/maisquiosque/projetos",
  dashboardController.getMaisQuiosqueProjetosDashboard,
);

module.exports = router;

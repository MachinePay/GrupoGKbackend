const { Router } = require("express");
const cadastroController = require("../controllers/cadastroController");
const {
  validateCreateConta,
  validateCreateEmpresa,
  validateCreateProjeto,
} = require("../middlewares/validateRequest");

const router = Router();

router.get("/empresas", cadastroController.listEmpresas);
router.post(
  "/empresas",
  validateCreateEmpresa,
  cadastroController.createEmpresa,
);

router.get("/contas-bancarias", cadastroController.listContas);
router.post(
  "/contas-bancarias",
  validateCreateConta,
  cadastroController.createConta,
);

router.get("/projetos", cadastroController.listProjetos);
router.post(
  "/projetos",
  validateCreateProjeto,
  cadastroController.createProjeto,
);

module.exports = router;

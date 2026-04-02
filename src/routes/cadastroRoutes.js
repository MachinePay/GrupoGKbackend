const { Router } = require("express");
const cadastroController = require("../controllers/cadastroController");
const {
  validateCreateConta,
  validateCreateEmpresa,
  validateCreateProjeto,
  validateEmpresaIdParam,
  validateUpdateEmpresa,
} = require("../middlewares/validateRequest");

const router = Router();

router.get("/empresas", cadastroController.listEmpresas);
router.post(
  "/empresas",
  validateCreateEmpresa,
  cadastroController.createEmpresa,
);
router.patch(
  "/empresas/:id",
  validateEmpresaIdParam,
  validateUpdateEmpresa,
  cadastroController.updateEmpresa,
);
router.delete(
  "/empresas/:id",
  validateEmpresaIdParam,
  cadastroController.deleteEmpresa,
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

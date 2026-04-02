const { Router } = require("express");
const movimentacaoController = require("../controllers/movimentacaoController");
const {
  validateCreateMovimentacao,
  validateMovimentacaoIdParam,
  validateMovimentacoesQuery,
} = require("../middlewares/validateRequest");

const router = Router();

router.get(
  "/",
  validateMovimentacoesQuery,
  movimentacaoController.listMovimentacoes,
);

router.post(
  "/",
  validateCreateMovimentacao,
  movimentacaoController.createMovimentacao,
);

router.delete(
  "/:id",
  validateMovimentacaoIdParam,
  movimentacaoController.deleteMovimentacao,
);

module.exports = router;

const { Router } = require("express");
const movimentacaoController = require("../controllers/movimentacaoController");
const {
  validateCreateMovimentacao,
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

module.exports = router;

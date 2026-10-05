const { Router } = require("express");
const cotacaoController = require("../controllers/cotacaoController");

const router = Router();

/**
 * GET /api/cotacoes
 * Lista as cotacoes de moedas (USD, EUR) em reais.
 */
router.get("/", cotacaoController.getCotacoes);

/**
 * PUT /api/cotacoes
 * Atualiza as cotacoes. Body: { USD?: number, EUR?: number }
 */
router.put("/", cotacaoController.updateCotacoes);

module.exports = router;

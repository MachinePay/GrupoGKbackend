const { Router } = require("express");
const { getFornecedores } = require("../services/agendaService");

const router = Router();

/**
 * GET /api/fornecedores
 * Lista todos os fornecedores ativos.
 */
router.get("/", async (req, res, next) => {
  try {
    const dados = await getFornecedores();
    res.json(dados);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

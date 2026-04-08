const { Router } = require("express");
const fornecedorController = require("../controllers/fornecedorController");

const router = Router();

/**
 * GET /api/fornecedores
 * Lista todos os fornecedores (com opção de filtrar por ativo).
 */
router.get("/", fornecedorController.getFornecedores);

/**
 * POST /api/fornecedores
 * Cria um novo fornecedor.
 */
router.post("/", fornecedorController.createFornecedor);

/**
 * PUT /api/fornecedores/:id
 * Atualiza um fornecedor existente.
 */
router.put("/:id", fornecedorController.updateFornecedor);

/**
 * PATCH /api/fornecedores/:id/toggle
 * Alterna o status ativo/inativo de um fornecedor.
 */
router.patch("/:id/toggle", fornecedorController.toggleFornecedor);

/**
 * DELETE /api/fornecedores/:id
 * Exclui um fornecedor.
 */
router.delete("/:id", fornecedorController.deleteFornecedor);

module.exports = router;

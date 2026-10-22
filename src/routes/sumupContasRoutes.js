const { Router } = require("express");
const sumupContasController = require("../controllers/sumupContasController");
const { authorize } = require("../middlewares/authMiddleware");

const router = Router();

// As chaves da SumUp so sao gerenciadas por administradores.
router.use(authorize("ADMIN"));

router.get("/", sumupContasController.listar);
router.post("/", sumupContasController.criar);
router.put("/:id", sumupContasController.atualizar);
router.delete("/:id", sumupContasController.excluir);
router.get("/:id/maquininhas", sumupContasController.listarMaquininhas);
router.delete("/:id/maquininhas/:readerId", sumupContasController.esquecerMaquininha);

module.exports = router;

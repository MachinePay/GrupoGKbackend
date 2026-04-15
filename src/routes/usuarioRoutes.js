const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/authMiddleware");
const usuarioController = require("../controllers/usuarioController");
const AppError = require("../middlewares/appError");

/**
 * Middleware para validar permissão ADMIN.
 */
function validarAdmin(req, res, next) {
  if (req.user?.perfil !== "ADMIN") {
    return next(
      new AppError(
        "Acesso negado. Apenas administradores podem gerenciar usuários.",
        403,
      ),
    );
  }
  next();
}

// Rotas de usuário (todas protegidas, gerenciamento só para ADMIN)
router.get("/", authenticate, usuarioController.listar);
router.post("/", authenticate, validarAdmin, usuarioController.criar);
router.put("/:id", authenticate, validarAdmin, usuarioController.atualizar);
router.delete("/:id", authenticate, validarAdmin, usuarioController.deletar);

module.exports = router;

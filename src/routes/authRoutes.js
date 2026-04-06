const { Router } = require("express");
const authController = require("../controllers/authController");
const { authenticate, authorize } = require("../middlewares/authMiddleware");
const {
  validateChangePassword,
  validateLogin,
  validateRegister,
  validateUpdateTheme,
} = require("../middlewares/validateRequest");

const router = Router();

router.post("/login", validateLogin, authController.login);
router.get("/me", authenticate, authController.me);
router.patch(
  "/me/senha",
  authenticate,
  validateChangePassword,
  authController.changePassword,
);
router.patch(
  "/me/tema",
  authenticate,
  validateUpdateTheme,
  authController.updateTheme,
);

router.get(
  "/users",
  authenticate,
  authorize("ADMIN"),
  authController.listUsers,
);
router.post(
  "/users",
  authenticate,
  authorize("ADMIN"),
  validateRegister,
  authController.createUser,
);
router.patch(
  "/users/:id/status",
  authenticate,
  authorize("ADMIN"),
  authController.toggleUserStatus,
);

module.exports = router;

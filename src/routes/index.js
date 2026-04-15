const { Router } = require("express");
const agendaRoutes = require("./agendaRoutes");
const authRoutes = require("./authRoutes");
const cadastroRoutes = require("./cadastroRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const movimentacaoRoutes = require("./movimentacaoRoutes");
const integracaoRoutes = require("./integracaoRoutes");
const relatoriosRoutes = require("./relatoriosRoutes");
const fornecedoresRoutes = require("./fornecedoresRoutes");
const selfMachineRoutes = require("./selfMachineRoutes");
const usuarioRoutes = require("./usuarioRoutes");
const { authenticate } = require("../middlewares/authMiddleware");

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRoutes);
router.use(authenticate);

router.use("/usuarios", usuarioRoutes);
router.use("/movimentacoes", movimentacaoRoutes);
router.use("/dashboards", dashboardRoutes);
router.use("/relatorios", relatoriosRoutes);
router.use("/agenda", agendaRoutes);
router.use("/cadastros", cadastroRoutes);
router.use("/integracao", integracaoRoutes);
router.use("/fornecedores", fornecedoresRoutes);
router.use("/selfmachine", selfMachineRoutes);

module.exports = router;

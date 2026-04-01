const { Router } = require("express");
const agendaRoutes = require("./agendaRoutes");
const authRoutes = require("./authRoutes");
const cadastroRoutes = require("./cadastroRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const movimentacaoRoutes = require("./movimentacaoRoutes");
const { authenticate } = require("../middlewares/authMiddleware");

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRoutes);
router.use(authenticate);

router.use("/movimentacoes", movimentacaoRoutes);
router.use("/dashboards", dashboardRoutes);
router.use("/agenda", agendaRoutes);
router.use("/cadastros", cadastroRoutes);

module.exports = router;

const { Router } = require("express");
const relatoriosController = require("../controllers/relatoriosController");

const router = Router();

router.get("/analytics", relatoriosController.getAnalytics);

module.exports = router;

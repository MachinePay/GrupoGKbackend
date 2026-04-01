const { Router } = require("express");
const agendaController = require("../controllers/agendaController");
const {
  validateAgendaQuery,
  validateCreateAgendaItem,
  validateAgendaSettlement,
} = require("../middlewares/validateRequest");

const router = Router();

router.get("/", validateAgendaQuery, agendaController.getAgendaItems);
router.get(
  "/baixas",
  validateAgendaQuery,
  agendaController.getAgendaSettlementHistory,
);
router.post("/", validateCreateAgendaItem, agendaController.createAgendaItem);
router.put("/:id", validateCreateAgendaItem, agendaController.updateAgendaItem);
router.delete("/:id", agendaController.deleteAgendaItem);
router.post(
  "/:id/baixar",
  validateAgendaSettlement,
  agendaController.settleAgendaItem,
);

module.exports = router;

const { Router } = require("express");
const integracaoController = require("../controllers/integracaoController");

const router = Router();

/**
 * GET /integracao/empresas-integradas
 * Lista empresas com integração ativa (conforme backend/env)
 */
router.get(
  "/empresas-integradas",
  integracaoController.listarEmpresasIntegradas,
);

/**
 * GET /integracao/agarramais/sync?empresaId=1
 * Dispara sincronização com API da AgarraMais
 */
router.get("/agarramais/sync", integracaoController.syncAgarraMais);

/**
 * GET /integracao/pendencias?empresaId=1
 * Lista todos os itens pendentes de aprovação de uma empresa
 */
router.get("/pendencias", integracaoController.listarPendencias);

/**
 * GET /integracao/estatisticas?empresaId=1&dataInicio=2026-03-01&dataFim=2026-03-31
 * Obtém estatísticas de pendências em um período
 */
router.get("/estatisticas", integracaoController.obterEstatisticas);

/**
 * POST /integracao/aprovar/:agendaId
 * Aprova uma pendência e cria a movimentação real
 * Body:
 * {
 *   "valorAjustado": 3450.50,  // opcional - permite ajustar valor
 *   "categoriaAjustada": "DESPESAS_ADMINISTRATIVAS",  // opcional
 *   "contaId": 1  // obrigatório para vincular à conta
 * }
 */
router.post("/aprovar/:agendaId", integracaoController.aprovarPendencia);

/**
 * POST /integracao/rejeitar/:agendaId
 * Rejeita uma pendência sem criar movimentação
 * Body:
 * {
 *   "motivo": "Valor incorreto ou duplicado"
 * }
 */
router.post("/rejeitar/:agendaId", integracaoController.rejeitarPendencia);

module.exports = router;

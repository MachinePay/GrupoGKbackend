const integracaoService = require("../services/integracaoService");
const AppError = require("../middlewares/appError");

/**
 * GET /integracao/agarramais/sync
 * Dispara sincronização com API da AgarraMais
 */
async function syncAgarraMais(req, res, next) {
  try {
    const { empresaId, dataInicio, dataFim, lojaIds } = req.query;
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      throw new AppError("Usuario nao autenticado.", 401);
    }

    if (!empresaId) {
      throw new AppError("empresaId é obrigatório como query parameter", 400);
    }

    const resultado = await integracaoService.syncAgarraMais(
      Number(empresaId),
      usuarioId,
      {
        dataInicio,
        dataFim,
        lojaIds: lojaIds
          ? String(lojaIds)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
      },
    );

    res.status(200).json({
      mensagem: "Sincronização com AgarraMais concluída",
      ...resultado,
    });
  } catch (erro) {
    next(erro);
  }
}

/**
 * GET /integracao/maisquiosque/sync
 * Dispara sincronização com API da MaisQuiosque
 */
async function syncMaisQuiosque(req, res, next) {
  try {
    const { empresaId, referenceMonth } = req.query;
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      throw new AppError("Usuario nao autenticado.", 401);
    }

    if (!empresaId) {
      throw new AppError("empresaId é obrigatório como query parameter", 400);
    }

    const resultado = await integracaoService.syncMaisQuiosque(
      Number(empresaId),
      usuarioId,
      { referenceMonth },
    );

    res.status(200).json({
      mensagem: "Sincronização com MaisQuiosque concluída",
      ...resultado,
    });
  } catch (erro) {
    next(erro);
  }
}

/**
 * GET /integracao/pendencias
 * Lista itens pendentes de aprovação
 */
async function listarPendencias(req, res, next) {
  try {
    const { empresaId } = req.query;

    if (!empresaId) {
      throw new AppError("empresaId é obrigatório", 400);
    }

    const pendencias = await integracaoService.listarPendencias(
      Number(empresaId),
    );

    res.status(200).json({
      total: pendencias.length,
      dados: pendencias,
    });
  } catch (erro) {
    next(erro);
  }
}

/**
 * POST /integracao/aprovar/:agendaId
 * Aprova uma pendência e cria a movimentação real
 */
async function aprovarPendencia(req, res, next) {
  try {
    const { agendaId } = req.params;
    const { valorAjustado, categoriaAjustada, tipoDespesaAjustada, contaId } =
      req.body;
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      throw new AppError("Usuario nao autenticado.", 401);
    }

    if (!agendaId) {
      throw new AppError("agendaId é obrigatório", 400);
    }

    const resultado = await integracaoService.aprovarPendencia(
      Number(agendaId),
      usuarioId,
      {
        valorAjustado,
        categoriaAjustada,
        tipoDespesaAjustada,
        contaId,
      },
    );

    res.status(200).json({
      mensagem: "Pendência aprovada com sucesso",
      ...resultado,
    });
  } catch (erro) {
    next(erro);
  }
}

/**
 * POST /integracao/rejeitar/:agendaId
 * Rejeita uma pendência sem criar movimentação
 */
async function rejeitarPendencia(req, res, next) {
  try {
    const { agendaId } = req.params;
    const { motivo } = req.body;

    if (!agendaId) {
      throw new AppError("agendaId é obrigatório", 400);
    }

    if (!motivo || motivo.trim().length === 0) {
      throw new AppError("motivo é obrigatório", 400);
    }

    await integracaoService.rejeitarPendencia(Number(agendaId), motivo);

    res.status(200).json({
      mensagem: "Pendência rejeitada com sucesso",
    });
  } catch (erro) {
    next(erro);
  }
}

/**
 * GET /integracao/estatisticas
 * Obtém estatísticas de pendências em um período
 */
async function obterEstatisticas(req, res, next) {
  try {
    const { empresaId, dataInicio, dataFim } = req.query;

    if (!empresaId) {
      throw new AppError("empresaId é obrigatório", 400);
    }

    const inicio = dataInicio ? new Date(dataInicio) : new Date();
    const fim = dataFim ? new Date(dataFim) : new Date();

    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      throw new AppError("Datas inválidas. Use formato ISO (YYYY-MM-DD)", 400);
    }

    const stats = await integracaoService.obterEstatisticasPendencias(
      Number(empresaId),
      inicio,
      fim,
    );

    res.status(200).json({
      periodo: { dataInicio: inicio, dataFim: fim },
      ...stats,
    });
  } catch (erro) {
    next(erro);
  }
}

/**
 * GET /integracao/empresas-integradas
 * Lista empresas que possuem integração ativa configurada.
 */
async function listarEmpresasIntegradas(req, res, next) {
  try {
    const resultado = await integracaoService.listarEmpresasIntegradas();
    res.status(200).json(resultado);
  } catch (erro) {
    next(erro);
  }
}

module.exports = {
  syncAgarraMais,
  syncMaisQuiosque,
  listarPendencias,
  aprovarPendencia,
  rejeitarPendencia,
  obterEstatisticas,
  listarEmpresasIntegradas,
};

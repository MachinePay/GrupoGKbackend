const sumupContasService = require("../services/sumupContasService");

/**
 * Cria handler Express padrao para o service.
 * @param {(req: import("express").Request) => Promise<unknown>} fn
 * @param {number} status
 */
function handler(fn, status = 200) {
  return async (req, res, next) => {
    try {
      const data = await fn(req);
      if (data === undefined) {
        res.status(204).send();
        return;
      }
      res.status(status).json(data);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  listar: handler(() => sumupContasService.listar()),
  criar: handler((req) => sumupContasService.criar(req.body, req.user), 201),
  atualizar: handler((req) =>
    sumupContasService.atualizar(req.params.id, req.body, req.user),
  ),
  excluir: handler((req) => sumupContasService.excluir(req.params.id)),
  listarMaquininhas: handler((req) =>
    sumupContasService.listarMaquininhas(req.params.id),
  ),
  esquecerMaquininha: handler((req) =>
    sumupContasService.esquecerMaquininha(req.params.id, req.params.readerId),
  ),
};

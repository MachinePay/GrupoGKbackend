const {
  AgendaStatus,
  AgendaTipo,
  GiraKidsSubcategoria,
  MovimentacaoCategoria,
  MovimentacaoStatus,
  MovimentacaoTipo,
  PerfilUsuario,
} = require("@prisma/client");
const AppError = require("./appError");

/**
 * Verifica se uma string representa data valida.
 * @param {string | undefined | null} value Valor da data.
 * @returns {boolean}
 */
function isValidDate(value) {
  return !!value && !Number.isNaN(new Date(value).getTime());
}

/**
 * Valida o corpo da requisicao de criacao de movimentacao.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateCreateMovimentacao(req, _res, next) {
  const {
    data,
    valor,
    tipo,
    status,
    empresaId,
    categoria,
    subcategoria,
    canalOrigem,
    centroOperacao,
  } = req.body;

  if (!data || Number.isNaN(new Date(data).getTime())) {
    return next(
      new AppError("Campo data obrigatorio e deve ser uma data valida.", 400),
    );
  }

  if (
    valor === undefined ||
    valor === null ||
    Number.isNaN(Number(valor)) ||
    Number(valor) <= 0
  ) {
    return next(
      new AppError("Campo valor obrigatorio e deve ser maior que zero.", 400),
    );
  }

  if (!Object.values(MovimentacaoTipo).includes(tipo)) {
    return next(new AppError("Campo tipo invalido.", 400));
  }

  if (!Object.values(MovimentacaoStatus).includes(status)) {
    return next(new AppError("Campo status invalido.", 400));
  }

  if (categoria && !Object.values(MovimentacaoCategoria).includes(categoria)) {
    return next(new AppError("Campo categoria invalido.", 400));
  }

  if (
    subcategoria &&
    !Object.values(GiraKidsSubcategoria).includes(subcategoria)
  ) {
    return next(new AppError("Campo subcategoria invalido.", 400));
  }

  if (
    canalOrigem !== undefined &&
    canalOrigem !== null &&
    typeof canalOrigem !== "string"
  ) {
    return next(new AppError("Campo canalOrigem deve ser texto.", 400));
  }

  if (
    centroOperacao !== undefined &&
    centroOperacao !== null &&
    typeof centroOperacao !== "string"
  ) {
    return next(new AppError("Campo centroOperacao deve ser texto.", 400));
  }

  if (!empresaId || Number.isNaN(Number(empresaId))) {
    return next(
      new AppError("Campo empresaId obrigatorio e deve ser numerico.", 400),
    );
  }

  return next();
}

/**
 * Valida filtros opcionais de consulta historica de movimentacoes.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateMovimentacoesQuery(req, _res, next) {
  const {
    empresaId,
    contaId,
    categoria,
    tipo,
    status,
    canalOrigem,
    centroOperacao,
    dataInicio,
    dataFim,
    page,
    limit,
  } = req.query;

  if (empresaId !== undefined && Number.isNaN(Number(empresaId))) {
    return next(new AppError("Parametro empresaId invalido.", 400));
  }

  if (contaId !== undefined && Number.isNaN(Number(contaId))) {
    return next(new AppError("Parametro contaId invalido.", 400));
  }

  if (categoria && !Object.values(MovimentacaoCategoria).includes(categoria)) {
    return next(new AppError("Parametro categoria invalido.", 400));
  }

  if (tipo && !Object.values(MovimentacaoTipo).includes(tipo)) {
    return next(new AppError("Parametro tipo invalido.", 400));
  }

  if (status && !Object.values(MovimentacaoStatus).includes(status)) {
    return next(new AppError("Parametro status invalido.", 400));
  }

  if (
    canalOrigem !== undefined &&
    canalOrigem !== null &&
    typeof canalOrigem !== "string"
  ) {
    return next(new AppError("Parametro canalOrigem invalido.", 400));
  }

  if (
    centroOperacao !== undefined &&
    centroOperacao !== null &&
    typeof centroOperacao !== "string"
  ) {
    return next(new AppError("Parametro centroOperacao invalido.", 400));
  }

  if (dataInicio && !isValidDate(dataInicio)) {
    return next(new AppError("Parametro dataInicio invalido.", 400));
  }

  if (dataFim && !isValidDate(dataFim)) {
    return next(new AppError("Parametro dataFim invalido.", 400));
  }

  if (
    page !== undefined &&
    (Number.isNaN(Number(page)) ||
      Number(page) < 1 ||
      !Number.isInteger(Number(page)))
  ) {
    return next(new AppError("Parametro page invalido.", 400));
  }

  if (
    limit !== undefined &&
    (Number.isNaN(Number(limit)) ||
      Number(limit) < 1 ||
      !Number.isInteger(Number(limit)))
  ) {
    return next(new AppError("Parametro limit invalido.", 400));
  }

  return next();
}

/**
 * Valida os filtros opcionais do endpoint de agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateAgendaQuery(req, _res, next) {
  const { dataInicio, dataFim, page, limit } = req.query;

  if (dataInicio && !isValidDate(dataInicio)) {
    return next(new AppError("Parametro dataInicio invalido.", 400));
  }

  if (dataFim && !isValidDate(dataFim)) {
    return next(new AppError("Parametro dataFim invalido.", 400));
  }

  if (
    page !== undefined &&
    (Number.isNaN(Number(page)) ||
      Number(page) < 1 ||
      !Number.isInteger(Number(page)))
  ) {
    return next(new AppError("Parametro page invalido.", 400));
  }

  if (
    limit !== undefined &&
    (Number.isNaN(Number(limit)) ||
      Number(limit) < 1 ||
      !Number.isInteger(Number(limit)))
  ) {
    return next(new AppError("Parametro limit invalido.", 400));
  }

  return next();
}

/**
 * Valida criacao de empresa.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateCreateEmpresa(req, _res, next) {
  const { nome } = req.body;

  if (!nome || typeof nome !== "string" || nome.trim().length < 2) {
    return next(new AppError("Campo nome e obrigatorio para empresa.", 400));
  }

  return next();
}

/**
 * Valida criacao de conta bancaria.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateCreateConta(req, _res, next) {
  const { nome, banco, empresaId, saldoAtual } = req.body;

  if (!nome || typeof nome !== "string") {
    return next(
      new AppError("Campo nome e obrigatorio para conta bancaria.", 400),
    );
  }

  if (!banco || typeof banco !== "string") {
    return next(
      new AppError("Campo banco e obrigatorio para conta bancaria.", 400),
    );
  }

  if (!empresaId || Number.isNaN(Number(empresaId))) {
    return next(
      new AppError("Campo empresaId obrigatorio e deve ser numerico.", 400),
    );
  }

  if (
    saldoAtual !== undefined &&
    (Number.isNaN(Number(saldoAtual)) || Number(saldoAtual) < 0)
  ) {
    return next(
      new AppError(
        "Campo saldoAtual deve ser numerico e maior ou igual a zero.",
        400,
      ),
    );
  }

  return next();
}

/**
 * Valida criacao de projeto.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateCreateProjeto(req, _res, next) {
  const { nome, empresaId } = req.body;

  if (!nome || typeof nome !== "string") {
    return next(new AppError("Campo nome e obrigatorio para projeto.", 400));
  }

  if (!empresaId || Number.isNaN(Number(empresaId))) {
    return next(
      new AppError("Campo empresaId obrigatorio e deve ser numerico.", 400),
    );
  }

  return next();
}

/**
 * Valida criacao de item de agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateCreateAgendaItem(req, _res, next) {
  const {
    data,
    titulo,
    descricao,
    valor,
    prioridade,
    status,
    tipo,
    empresaId,
  } = req.body;

  if (!isValidDate(data)) {
    return next(
      new AppError("Campo data obrigatorio e deve ser uma data valida.", 400),
    );
  }

  if (!titulo || typeof titulo !== "string") {
    return next(new AppError("Campo titulo e obrigatorio para agenda.", 400));
  }

  if (
    descricao !== undefined &&
    descricao !== null &&
    typeof descricao !== "string"
  ) {
    return next(new AppError("Campo descricao deve ser texto.", 400));
  }

  if (
    valor === undefined ||
    Number.isNaN(Number(valor)) ||
    Number(valor) <= 0
  ) {
    return next(
      new AppError("Campo valor obrigatorio e deve ser maior que zero.", 400),
    );
  }

  if (!prioridade || typeof prioridade !== "string") {
    return next(
      new AppError("Campo prioridade e obrigatorio para agenda.", 400),
    );
  }

  if (!Object.values(AgendaStatus).includes(status)) {
    return next(new AppError("Campo status invalido para agenda.", 400));
  }

  if (!Object.values(AgendaTipo).includes(tipo)) {
    return next(new AppError("Campo tipo invalido para agenda.", 400));
  }

  if (!empresaId || Number.isNaN(Number(empresaId))) {
    return next(
      new AppError("Campo empresaId obrigatorio e deve ser numerico.", 400),
    );
  }

  return next();
}

/**
 * Valida o payload de baixa da agenda.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateAgendaSettlement(req, _res, next) {
  const { contaId, data, projetoId, subcategoria, categoria } = req.body;

  if (!contaId || Number.isNaN(Number(contaId))) {
    return next(
      new AppError("Campo contaId obrigatorio e deve ser numerico.", 400),
    );
  }

  if (data && !isValidDate(data)) {
    return next(new AppError("Campo data invalido para baixa.", 400));
  }

  if (
    projetoId !== undefined &&
    projetoId !== null &&
    Number.isNaN(Number(projetoId))
  ) {
    return next(new AppError("Campo projetoId deve ser numerico.", 400));
  }

  if (categoria && !Object.values(MovimentacaoCategoria).includes(categoria)) {
    return next(new AppError("Campo categoria invalido.", 400));
  }

  if (
    subcategoria &&
    !Object.values(GiraKidsSubcategoria).includes(subcategoria)
  ) {
    return next(new AppError("Campo subcategoria invalido.", 400));
  }

  return next();
}

/**
 * Valida payload de cadastro de usuario.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateRegister(req, _res, next) {
  const { nome, email, senha, perfil } = req.body;

  if (!nome || typeof nome !== "string" || nome.trim().length < 2) {
    return next(new AppError("Campo nome e obrigatorio para cadastro.", 400));
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return next(new AppError("Campo email invalido.", 400));
  }

  if (!senha || typeof senha !== "string" || senha.length < 6) {
    return next(
      new AppError("Campo senha deve ter ao menos 6 caracteres.", 400),
    );
  }

  if (perfil && !Object.values(PerfilUsuario).includes(perfil)) {
    return next(new AppError("Campo perfil invalido.", 400));
  }

  return next();
}

/**
 * Valida payload de login.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateLogin(req, _res, next) {
  const { email, senha } = req.body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return next(new AppError("Campo email invalido.", 400));
  }

  if (!senha || typeof senha !== "string") {
    return next(new AppError("Campo senha obrigatorio.", 400));
  }

  return next();
}

/**
 * Valida payload de troca de senha.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function validateChangePassword(req, _res, next) {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || typeof senhaAtual !== "string") {
    return next(new AppError("Campo senhaAtual obrigatorio.", 400));
  }

  if (!novaSenha || typeof novaSenha !== "string" || novaSenha.length < 6) {
    return next(
      new AppError("Campo novaSenha deve ter ao menos 6 caracteres.", 400),
    );
  }

  if (senhaAtual === novaSenha) {
    return next(
      new AppError("A nova senha deve ser diferente da senha atual.", 400),
    );
  }

  return next();
}

module.exports = {
  validateAgendaQuery,
  validateMovimentacoesQuery,
  validateChangePassword,
  validateCreateAgendaItem,
  validateAgendaSettlement,
  validateCreateConta,
  validateCreateEmpresa,
  validateCreateMovimentacao,
  validateCreateProjeto,
  validateLogin,
  validateRegister,
};

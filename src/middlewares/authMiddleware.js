const jwt = require("jsonwebtoken");
const env = require("../config/env");
const AppError = require("./appError");
const { chaveIaConfere, leituraIa, usuarioIa } = require("./chaveIa");

/**
 * Extrai token Bearer do cabecalho Authorization.
 * @param {import("express").Request} req Requisicao HTTP.
 * @returns {string | null}
 */
function getBearerToken(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

/**
 * Valida JWT e injeta dados do usuario no request.
 * @param {import("express").Request} req Requisicao HTTP.
 * @param {import("express").Response} _res Resposta HTTP.
 * @param {import("express").NextFunction} next Proximo middleware.
 * @returns {void}
 */
function authenticate(req, res, next) {
  if (req.headers["x-api-key"]) return authenticateChaveIa(req, res, next);
  const token = getBearerToken(req);

  if (!token) {
    return next(new AppError("Token de autenticacao ausente.", 401));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = {
      id: Number(payload.sub),
      email: payload.email,
      perfil: payload.perfil,
      contaBancariaId: payload.contaBancariaId
        ? Number(payload.contaBancariaId)
        : null,
      contaBancariaIds: Array.isArray(payload.contaBancariaIds)
        ? payload.contaBancariaIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : payload.contaBancariaId
          ? [Number(payload.contaBancariaId)]
          : [],
    };

    return next();
  } catch (_error) {
    return next(new AppError("Token invalido ou expirado.", 401));
  }
}

/**
 * Entrada da IA Central pela chave X-API-Key (ver chaveIa.js): so leitura.
 */
async function authenticateChaveIa(req, _res, next) {
  if (!chaveIaConfere(req)) return next(new AppError("Chave invalida.", 401));
  if (!leituraIa(req)) return next(new AppError("Chave da IA so le.", 403));
  try {
    const ia = await usuarioIa();
    if (!ia.ativo) return next(new AppError("Usuario Integracao IA inativo.", 401));
    req.user = { id: ia.id, email: ia.email, perfil: "ADMIN", contaBancariaId: null, contaBancariaIds: [] };
    req.viaChaveIa = true;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Exige um perfil especifico para acesso ao endpoint.
 * @param {"ADMIN" | "FINANCEIRO"} requiredPerfil Perfil minimo.
 * @returns {import("express").RequestHandler}
 */
function authorize(requiredPerfil) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError("Usuario nao autenticado.", 401));
    }

    if (req.user.perfil !== requiredPerfil && req.user.perfil !== "ADMIN") {
      return next(new AppError("Usuario sem permissao para esta acao.", 403));
    }

    return next();
  };
}

module.exports = {
  authenticate,
  authorize,
};

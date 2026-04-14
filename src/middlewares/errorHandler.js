const { Prisma } = require("@prisma/client");
const AppError = require("./appError");

/**
 * Traduz erros do Prisma para uma resposta HTTP consistente.
 * @param {unknown} error Erro original.
 * @returns {AppError}
 */
function normalizePrismaError(error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new AppError(
        "Registro duplicado para um campo unico.",
        409,
        error.meta,
      );
    }

    if (error.code === "P2025") {
      return new AppError(
        "Registro relacionado nao encontrado.",
        404,
        error.meta,
      );
    }

    return new AppError(
      "Erro de operacao com o banco de dados.",
      400,
      error.meta,
    );
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new AppError("Dados invalidos enviados para o Prisma.", 400, {
      prismaMessage: error.message,
    });
  }

  return new AppError("Erro interno no banco de dados.", 500);
}

/**
 * Middleware centralizado de tratamento de erros.
 * @param {unknown} error Erro recebido do fluxo da aplicacao.
 * @param {import("express").Request} _req Requisicao HTTP.
 * @param {import("express").Response} res Resposta HTTP.
 * @param {import("express").NextFunction} _next Proximo middleware.
 * @returns {void}
 */
function errorHandler(error, _req, res, _next) {
  console.error("[ERROR]", error.constructor.name, ":", error.message);

  const normalizedError =
    error instanceof AppError
      ? error
      : error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientValidationError
        ? normalizePrismaError(error)
        : new AppError("Erro interno do servidor.", 500);

  if (
    !(error instanceof AppError) &&
    !(error instanceof Prisma.PrismaClientKnownRequestError) &&
    !(error instanceof Prisma.PrismaClientValidationError)
  ) {
    console.error("[STACK]", error.stack);
  }

  res.status(normalizedError.statusCode).json({
    error: normalizedError.name,
    message: normalizedError.message,
    details: normalizedError.details || null,
  });
}

module.exports = errorHandler;

/**
 * Representa um erro de negocio controlado pela API.
 */
class AppError extends Error {
  /**
   * @param {string} message Mensagem de erro.
   * @param {number} statusCode Codigo HTTP.
   * @param {object | undefined} details Detalhes opcionais.
   */
  constructor(message, statusCode = 400, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = AppError;

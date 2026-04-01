const dotenv = require("dotenv");

dotenv.config();

/**
 * Le uma variavel de ambiente obrigatoria.
 * @param {string} key Nome da variavel.
 * @returns {string}
 */
function getRequiredEnv(key) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
  }

  return value;
}

/**
 * Retorna a configuracao consolidada da aplicacao.
 * @returns {{ port: number, databaseUrl: string, nodeEnv: string, jwtSecret: string, jwtExpiresIn: string }}
 */
function getEnvConfig() {
  return {
    port: Number(process.env.PORT || 3001),
    databaseUrl: getRequiredEnv("DATABASE_URL"),
    nodeEnv: process.env.NODE_ENV || "development",
    jwtSecret: getRequiredEnv("JWT_SECRET"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  };
}

module.exports = getEnvConfig();

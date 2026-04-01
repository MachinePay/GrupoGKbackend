const { PrismaClient } = require("@prisma/client");
const env = require("./env");

/**
 * Instancia unica do Prisma Client para a aplicacao.
 * @type {PrismaClient}
 */
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.databaseUrl,
    },
  },
});

module.exports = prisma;

const app = require("./app");
const env = require("./config/env");

/**
 * Inicializa o servidor HTTP da API.
 * @returns {void}
 */
function startServer() {
  app.listen(env.port, () => {
    console.log(`Servidor rodando na porta ${env.port}`);
  });
}

startServer();

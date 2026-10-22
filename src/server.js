const app = require("./app");
const env = require("./config/env");
const machinePayPainelService = require("./services/machinePayPainelService");
const sumupService = require("./services/sumupService");
const whatsappService = require("./services/whatsappService");

/**
 * Inicializa o servidor HTTP da API.
 * @returns {void}
 */
function startServer() {
  app.listen(env.port, () => {
    console.log(`Servidor rodando na porta ${env.port}`);
  });

  machinePayPainelService.iniciarSincronizacaoAutomatica();
  sumupService.iniciarConferenciaAutomatica();
  whatsappService.iniciarFila();
}

startServer();

// Envio automatico das cobrancas do Machine Pay no WhatsApp pela Evolution API.
// As cobrancas escolhidas entram numa fila gravada no banco (whatsapp_status)
// e saem uma por vez, com pausa aleatoria entre clientes para nao parecer
// disparo em massa. Cada mensagem leva o Pix SumUp exclusivo da cobranca,
// entao o pagamento da baixa sozinho.

const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const sumupService = require("./sumupService");

const STATUS = { FILA: "FILA", ENVIANDO: "ENVIANDO", ENVIADO: "ENVIADO", ERRO: "ERRO" };
const MAX_POR_ENVIO = 300;
const INTERVALO_MINIMO_SEGUNDOS = 8;
// Nao reenvia a mesma cobranca dentro deste prazo, salvo pedido explicito.
const JANELA_REENVIO_HORAS = 12;
const CHAVE_PIX_CNPJ = "59996204000177";

let processando = false;
let pausa = null;
let timer = null;

/**
 * Le a configuracao salva. Tolera a tabela ainda nao migrada.
 * @returns {Promise<object|null>}
 */
async function lerConfig() {
  try {
    return await prisma.machinePayWhatsappConfig.findUnique({ where: { id: 1 } });
  } catch (error) {
    if (error?.code === "P2021") {
      return null;
    }
    throw error;
  }
}

function mascararChave(apiKey) {
  if (!apiKey) {
    return null;
  }
  return apiKey.length <= 8 ? "••••" : `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

/**
 * Configuracao para a tela (a chave nunca volta inteira).
 * @returns {Promise<object>}
 */
async function getConfig() {
  const config = await lerConfig();
  return {
    ativo: Boolean(config?.ativo),
    evolutionUrl: config?.evolutionUrl ?? null,
    apiKeyConfigurada: Boolean(config?.apiKey),
    apiKeyMascarada: mascararChave(config?.apiKey),
    instancia: config?.instancia ?? null,
    intervaloSegundos: config?.intervaloSegundos ?? 20,
    updatedBy: config?.updatedBy ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}

/**
 * Salva a configuracao da Evolution API. apiKey vazio mantem a atual.
 * @param {object} payload
 * @param {object} user
 * @returns {Promise<object>}
 */
async function updateConfig(payload = {}, user) {
  const atual = await lerConfig();
  const data = { updatedBy: user?.email || null };

  if (payload.evolutionUrl !== undefined) {
    const url = String(payload.evolutionUrl || "").trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) {
      throw new AppError("A URL da Evolution API deve comecar com https://", 400);
    }
    data.evolutionUrl = url || null;
  }

  if (payload.apiKey !== undefined && String(payload.apiKey).trim()) {
    data.apiKey = String(payload.apiKey).trim();
  }

  if (payload.instancia !== undefined) {
    const instancia = String(payload.instancia || "").trim();
    if (instancia && !/^[\w.-]{1,60}$/.test(instancia)) {
      throw new AppError("Nome da instancia: use letras, numeros, ponto, hifen ou _.", 400);
    }
    data.instancia = instancia || null;
  }

  if (payload.intervaloSegundos !== undefined) {
    const segundos = Number(payload.intervaloSegundos);
    if (!Number.isInteger(segundos) || segundos < INTERVALO_MINIMO_SEGUNDOS || segundos > 600) {
      throw new AppError(
        `O intervalo entre mensagens deve ficar entre ${INTERVALO_MINIMO_SEGUNDOS} e 600 segundos.`,
        400,
      );
    }
    data.intervaloSegundos = segundos;
  }

  if (payload.ativo !== undefined) {
    data.ativo = Boolean(payload.ativo);
  }

  const final = { ...atual, ...data };
  if (data.ativo && (!final.evolutionUrl || !final.apiKey || !final.instancia)) {
    throw new AppError("Preencha URL, chave e instancia da Evolution API antes de ativar.", 400);
  }

  await prisma.machinePayWhatsappConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  agendarProcessamento(1000);
  return getConfig();
}

/**
 * Chama a Evolution API.
 * @param {object} config
 * @param {string} caminho
 * @param {{ method?: string, body?: object }} opcoes
 * @returns {Promise<any>}
 */
async function chamarEvolution(config, caminho, { method = "GET", body } = {}) {
  if (!config?.evolutionUrl || !config?.apiKey) {
    throw new AppError("Configure a URL e a chave da Evolution API.", 400);
  }

  let resposta;
  try {
    resposta = await fetch(`${config.evolutionUrl}${caminho}`, {
      method,
      headers: { apikey: config.apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new AppError(`Nao foi possivel falar com a Evolution API: ${error.message}`, 502);
  }

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch (_error) {
    dados = { message: texto };
  }

  if (!resposta.ok) {
    const bruto = dados?.response?.message ?? dados?.message ?? dados?.error ?? resposta.statusText;
    const detalhe = Array.isArray(bruto) ? bruto.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join("; ") : String(bruto);
    const erro = new AppError(
      resposta.status === 401 || resposta.status === 403
        ? "A Evolution API recusou a chave (apikey). Confira a configuracao."
        : /"exists":\s*false/.test(detalhe)
          ? "Este numero nao tem WhatsApp. Confira o telefone do cliente."
          : `Evolution API respondeu ${resposta.status}: ${detalhe}`,
      resposta.status === 404 ? 404 : 502,
    );
    erro.httpStatus = resposta.status;
    erro.detalhe = detalhe;
    throw erro;
  }

  return dados;
}

/**
 * Estado da conexao do numero (open = conectado).
 * @param {object} config
 * @returns {Promise<string>}
 */
async function lerEstadoConexao(config) {
  const r = await chamarEvolution(
    config,
    `/instance/connectionState/${encodeURIComponent(config.instancia)}`,
  );
  return r?.instance?.state || r?.state || "unknown";
}

/**
 * Situacao da conexao para a tela de configuracao.
 * @returns {Promise<object>}
 */
async function getConexao() {
  const config = await lerConfig();
  if (!config?.evolutionUrl || !config?.apiKey || !config?.instancia) {
    return { configurado: false, estado: null };
  }
  try {
    return { configurado: true, estado: await lerEstadoConexao(config) };
  } catch (error) {
    // Instancia ainda nao criada nao e erro: ela e criada ao conectar.
    if (error.httpStatus === 404) {
      return { configurado: true, estado: "inexistente" };
    }
    return { configurado: true, estado: "erro", erro: error.message };
  }
}

/**
 * Gera o QR Code para conectar o numero. Cria a instancia se ainda nao existir.
 * @returns {Promise<{ estado: string, qrBase64: string|null, pairingCode: string|null }>}
 */
async function conectar() {
  const config = await lerConfig();
  if (!config?.evolutionUrl || !config?.apiKey || !config?.instancia) {
    throw new AppError("Salve URL, chave e instancia da Evolution API antes de conectar.", 400);
  }

  const estado = await lerEstadoConexao(config).catch((error) => {
    if (error.httpStatus === 404) return "inexistente";
    throw error;
  });

  if (estado === "open") {
    return { estado, qrBase64: null, pairingCode: null };
  }

  let r;
  if (estado === "inexistente") {
    r = await chamarEvolution(config, "/instance/create", {
      method: "POST",
      body: { instanceName: config.instancia, integration: "WHATSAPP-BAILEYS", qrcode: true },
    });
    r = r?.qrcode || r;
  } else {
    r = await chamarEvolution(config, `/instance/connect/${encodeURIComponent(config.instancia)}`);
  }

  const base64 = r?.base64 || null;
  return {
    estado: "connecting",
    qrBase64: base64 && !base64.startsWith("data:") ? `data:image/png;base64,${base64}` : base64,
    pairingCode: r?.pairingCode || null,
  };
}

/**
 * Normaliza telefone para o formato da Evolution (55 + DDD + numero).
 * @param {string|null} telefone
 * @returns {string|null}
 */
function normalizarTelefone(telefone) {
  let d = String(telefone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) {
    d = `55${d}`;
  }
  return /^55\d{10,11}$/.test(d) ? d : null;
}

function formatarMoeda(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Dias desde o vencimento (gravado ao meio-dia UTC), pelo dia de hoje no Brasil.
 * @param {Date} vencimento
 * @returns {number}
 */
function diasDeAtraso(vencimento) {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12);
  return Math.max(0, Math.round((hoje - new Date(vencimento).getTime()) / 86400000));
}

/**
 * Texto da cobranca (o Pix copia e cola vai numa segunda mensagem,
 * sozinho, para o cliente copiar com um toque).
 * @param {object} cobranca
 * @param {boolean} comPixSumup
 * @returns {string}
 */
function montarMensagem(cobranca, comPixSumup, pixValidoAte = null) {
  const maquinas = cobranca.maquinasProprias + cobranca.maquinasPlano36;
  const dia = new Date(cobranca.vencimento).getUTCDate();
  const dias = diasDeAtraso(cobranca.vencimento);
  const pagamento = comPixSumup
    ? "💳 Pagamento via Pix\nO código Pix copia e cola vem na próxima mensagem. A baixa é automática, não precisa enviar comprovante. ✅\n" +
      (pixValidoAte
        ? `Pix válido até ${new Date(pixValidoAte).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.\n\n`
        : "\n")
    : `💳 Pagamento via Pix\nChave CNPJ:\n${CHAVE_PIX_CNPJ}\n\nApós o pagamento, envie o comprovante por este WhatsApp para confirmarmos a baixa.\n\n`;

  if (dias > 0) {
    return (
      "Olá! Tudo bem?\n\n" +
      "MachinePay | Financeiro\n\n" +
      `Identificamos que a mensalidade abaixo permanece em aberto, com ${dias} ${dias === 1 ? "dia" : "dias"} de atraso:\n\n` +
      `▪️ Equipamentos ativos: ${maquinas}\n` +
      `▪️ Valor total: ${formatarMoeda(cobranca.valor)}\n` +
      `▪️ Vencimento: dia ${dia}\n\n` +
      "⚠️ Evite o bloqueio do cadastro e a suspensão dos serviços. Pedimos que regularize o pagamento para manter seus equipamentos conectados à MachinePay.\n\n" +
      pagamento +
      "Se precisar de ajuda para regularizar, fale com a nossa equipe.\n\n" +
      "Equipe Financeira | MachinePay"
    );
  }

  return (
    "Olá! Tudo bem? 😊\n\n" +
    "MachinePay | Financeiro\n\n" +
    "Segue a sua mensalidade:\n\n" +
    `▪️ Equipamentos ativos: ${maquinas}\n` +
    `▪️ Valor total: ${formatarMoeda(cobranca.valor)}\n` +
    `▪️ Vencimento: dia ${dia}\n\n` +
    pagamento +
    "Agradecemos pela parceria! Estamos à disposição para ajudar.\n\n" +
    "Equipe Financeira | MachinePay"
  );
}

async function enviarTexto(config, numero, texto) {
  return chamarEvolution(config, `/message/sendText/${encodeURIComponent(config.instancia)}`, {
    method: "POST",
    body: { number: numero, text: texto, delay: 1200 },
  });
}

/**
 * Coloca as cobrancas escolhidas na fila de envio.
 * @param {number[]} ids
 * @param {{ reenviar?: boolean }} opcoes
 * @returns {Promise<{ enfileiradas: number, ignoradas: Array<{ id: number, nome: string, motivo: string }> }>}
 */
async function enfileirar(ids, { reenviar = false } = {}) {
  const config = await lerConfig();
  if (!config?.ativo) {
    throw new AppError("O envio pelo WhatsApp esta desativado. Configure na aba Integrações.", 409);
  }

  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!lista.length) {
    throw new AppError("Selecione ao menos uma cobranca.", 400);
  }
  if (lista.length > MAX_POR_ENVIO) {
    throw new AppError(`Envie no maximo ${MAX_POR_ENVIO} cobrancas por vez.`, 400);
  }

  const cobrancas = await prisma.machinePayCobranca.findMany({
    where: { id: { in: lista } },
    include: { cliente: true },
  });

  const limiteReenvio = Date.now() - JANELA_REENVIO_HORAS * 60 * 60 * 1000;
  const ignoradas = [];
  const aceitas = [];

  for (const c of cobrancas) {
    let motivo = null;
    if (c.status !== "PENDENTE") motivo = "não está em aberto";
    else if (!normalizarTelefone(c.cliente.telefone)) motivo = "sem telefone válido";
    else if (c.whatsappStatus === STATUS.FILA || c.whatsappStatus === STATUS.ENVIANDO) motivo = "já está na fila";
    else if (!reenviar && c.whatsappEnviadoEm && c.whatsappEnviadoEm.getTime() > limiteReenvio) {
      motivo = `já enviada há menos de ${JANELA_REENVIO_HORAS}h`;
    }

    if (motivo) ignoradas.push({ id: c.id, nome: c.cliente.nome, motivo });
    else aceitas.push(c.id);
  }

  if (aceitas.length) {
    await prisma.machinePayCobranca.updateMany({
      where: { id: { in: aceitas }, status: "PENDENTE" },
      data: { whatsappStatus: STATUS.FILA, whatsappNaFilaEm: new Date(), whatsappErro: null },
    });
    agendarProcessamento(500);
  }

  return { enfileiradas: aceitas.length, ignoradas };
}

/**
 * Tira da fila o que ainda nao saiu.
 * @returns {Promise<{ canceladas: number }>}
 */
async function cancelarFila() {
  const r = await prisma.machinePayCobranca.updateMany({
    where: { whatsappStatus: STATUS.FILA },
    data: { whatsappStatus: null, whatsappNaFilaEm: null },
  });
  return { canceladas: r.count };
}

/**
 * Situacao da fila para a barra de progresso.
 * @returns {Promise<object>}
 */
async function getStatusFila() {
  const config = await lerConfig();
  if (!config) {
    return { ativo: false, fila: 0, enviando: null, pausa: null };
  }

  const [fila, enviando] = await Promise.all([
    prisma.machinePayCobranca.count({ where: { whatsappStatus: STATUS.FILA } }),
    prisma.machinePayCobranca.findFirst({
      where: { whatsappStatus: STATUS.ENVIANDO },
      select: { id: true, cliente: { select: { nome: true } } },
    }),
  ]);

  return {
    ativo: Boolean(config.ativo),
    fila,
    enviando: enviando ? { id: enviando.id, nome: enviando.cliente.nome } : null,
    pausa,
    intervaloSegundos: config.intervaloSegundos,
  };
}

/**
 * Envia uma cobranca: gera (ou reaproveita) o Pix SumUp e manda as mensagens.
 * @param {object} config
 * @param {number} id
 */
async function enviarCobranca(config, id) {
  const cobranca = await prisma.machinePayCobranca.findUnique({
    where: { id },
    include: { cliente: true },
  });

  if (!cobranca || cobranca.status !== "PENDENTE") {
    // Pagou ou foi cancelada enquanto esperava na fila: nao envia.
    if (cobranca) {
      await prisma.machinePayCobranca.update({
        where: { id },
        data: { whatsappStatus: null, whatsappNaFilaEm: null },
      });
    }
    return;
  }

  const numero = normalizarTelefone(cobranca.cliente.telefone);
  if (!numero) {
    throw new AppError("Telefone do cliente invalido.", 400);
  }

  const sumup = await sumupService.getConfig();
  let copiaCola = null;
  let validoAte = null;
  if (sumup.ativo) {
    const pix = await sumupService.gerarPix(cobranca.id);
    copiaCola = pix.copiaCola;
    validoAte = pix.validoAte;
    if (!copiaCola) {
      throw new AppError("A SumUp nao devolveu o Pix copia e cola.", 502);
    }
  }

  await enviarTexto(config, numero, montarMensagem(cobranca, Boolean(copiaCola), validoAte));
  if (copiaCola) {
    await enviarTexto(config, numero, copiaCola);
  }
}

/**
 * Processa a fila: uma cobranca por vez, com pausa aleatoria entre envios.
 * Se o WhatsApp estiver desconectado, para e tenta de novo em 1 minuto,
 * sem marcar erro nas cobrancas.
 */
async function processarFila() {
  if (processando) return;
  processando = true;
  timer = null;

  let proximaEm = null;
  try {
    const config = await lerConfig();
    if (!config?.ativo) {
      pausa = null;
      return;
    }

    const proxima = await prisma.machinePayCobranca.findFirst({
      where: { whatsappStatus: STATUS.FILA },
      orderBy: [{ whatsappNaFilaEm: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!proxima) {
      pausa = null;
      return;
    }

    let estado;
    try {
      estado = await lerEstadoConexao(config);
    } catch (error) {
      estado = error.message;
    }
    if (estado !== "open") {
      pausa = estado === "close" || estado === "connecting"
        ? "WhatsApp desconectado. Conecte o número na aba Integrações."
        : `Evolution API indisponível: ${estado}`;
      proximaEm = 60 * 1000;
      return;
    }
    pausa = null;

    // Marca ENVIANDO so se ainda estiver na fila (pode ter sido cancelada).
    const reservada = await prisma.machinePayCobranca.updateMany({
      where: { id: proxima.id, whatsappStatus: STATUS.FILA },
      data: { whatsappStatus: STATUS.ENVIANDO },
    });
    if (!reservada.count) {
      proximaEm = 500;
      return;
    }

    try {
      await enviarCobranca(config, proxima.id);
      await prisma.machinePayCobranca.updateMany({
        where: { id: proxima.id, whatsappStatus: STATUS.ENVIANDO },
        data: { whatsappStatus: STATUS.ENVIADO, whatsappEnviadoEm: new Date(), whatsappErro: null },
      });
    } catch (error) {
      console.error(`[whatsapp] cobranca ${proxima.id}:`, error.message);
      await prisma.machinePayCobranca.updateMany({
        where: { id: proxima.id, whatsappStatus: STATUS.ENVIANDO },
        data: { whatsappStatus: STATUS.ERRO, whatsappErro: String(error.message).slice(0, 500) },
      });
    }

    // Pausa de intervalo +/- 30% para nao parecer disparo automatico.
    const base = Math.max(INTERVALO_MINIMO_SEGUNDOS, config.intervaloSegundos) * 1000;
    proximaEm = Math.round(base * (0.7 + Math.random() * 0.6));
  } catch (error) {
    console.error("[whatsapp] fila falhou:", error.message);
    proximaEm = 60 * 1000;
  } finally {
    processando = false;
    if (proximaEm !== null) agendarProcessamento(proximaEm);
  }
}

function agendarProcessamento(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    processarFila().catch((error) => console.error("[whatsapp] fila:", error.message));
  }, ms);
}

/**
 * Ao subir o servidor: o que ficou em ENVIANDO volta para a fila e o envio
 * continua de onde parou.
 */
async function iniciarFila() {
  try {
    await prisma.machinePayCobranca.updateMany({
      where: { whatsappStatus: STATUS.ENVIANDO },
      data: { whatsappStatus: STATUS.FILA },
    });
  } catch (error) {
    if (error?.code !== "P2021" && error?.code !== "P2022") {
      console.error("[whatsapp] iniciar fila:", error.message);
    }
    return;
  }
  agendarProcessamento(15 * 1000);
}

module.exports = {
  getConfig,
  updateConfig,
  getConexao,
  conectar,
  enfileirar,
  cancelarFila,
  getStatusFila,
  iniciarFila,
  processarFila,
  normalizarTelefone,
  montarMensagem,
};

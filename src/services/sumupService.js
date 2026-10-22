// Integracao com a SumUp: gera um Pix dinamico (QR + copia e cola) por
// cobranca do Machine Pay e da baixa automatica quando o pagamento cai.
// A SumUp avisa pelo return_url (webhook) e, como garantia, o servidor
// tambem confere de tempos em tempos os Pix ainda em aberto.

const crypto = require("crypto");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const machinePayService = require("./machinePayService");

const SUMUP_API = "https://api.sumup.com";
const TIPOS_PIX = ["pix", "qr_code_pix"];
const INTERVALO_CONFERENCIA_MIN = 5;
const FORMA_PAGAMENTO = "PIX SumUp";

// Webhook e conferencia periodica podem chegar juntos: um checkout por vez.
const conferenciasEmAndamento = new Map();

/**
 * Le a configuracao salva (sem mascarar). Tolera a tabela ainda nao migrada.
 * @returns {Promise<object|null>}
 */
async function lerConfig() {
  try {
    return await prisma.machinePaySumupConfig.findUnique({ where: { id: 1 } });
  } catch (error) {
    if (error?.code === "P2021") {
      return null;
    }
    throw error;
  }
}

/**
 * Mostra so o comeco e o fim da chave da API.
 * @param {string|null} apiKey
 * @returns {string|null}
 */
function mascararChave(apiKey) {
  if (!apiKey) {
    return null;
  }
  return apiKey.length <= 12
    ? "••••"
    : `${apiKey.slice(0, 8)}••••${apiKey.slice(-4)}`;
}

/**
 * Monta a URL do webhook que a SumUp chama quando o checkout muda de status.
 * @param {object|null} config
 * @returns {string|null}
 */
function montarWebhookUrl(config) {
  if (!config?.urlPublica || !config?.webhookToken) {
    return null;
  }
  return `${config.urlPublica.replace(/\/+$/, "")}/api/webhooks/sumup/${config.webhookToken}`;
}

/**
 * Configuracao para a tela (a chave da API nunca volta inteira).
 * @returns {Promise<object>}
 */
async function getConfig() {
  const config = await lerConfig();
  return {
    ativo: Boolean(config?.ativo),
    apiKeyConfigurada: Boolean(config?.apiKey),
    apiKeyMascarada: mascararChave(config?.apiKey),
    merchantCode: config?.merchantCode ?? null,
    tipoPix: config?.tipoPix ?? "pix",
    validadeHoras: config?.validadeHoras ?? 72,
    contaDestinoId: config?.contaDestinoId ?? null,
    urlPublica: config?.urlPublica ?? null,
    webhookUrl: montarWebhookUrl(config),
    updatedBy: config?.updatedBy ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}

/**
 * Salva a configuracao da conta SumUp. apiKey vazio mantem a chave atual.
 * @param {object} payload
 * @param {object} user
 * @returns {Promise<object>}
 */
async function updateConfig(payload = {}, user) {
  const atual = await lerConfig();
  const data = { updatedBy: user?.email || null };

  if (payload.apiKey !== undefined && String(payload.apiKey).trim()) {
    data.apiKey = String(payload.apiKey).trim();
  }

  if (payload.merchantCode !== undefined) {
    data.merchantCode = String(payload.merchantCode || "").trim().toUpperCase() || null;
  }

  if (payload.tipoPix !== undefined) {
    if (!TIPOS_PIX.includes(payload.tipoPix)) {
      throw new AppError("Tipo de Pix invalido. Use pix ou qr_code_pix.", 400);
    }
    data.tipoPix = payload.tipoPix;
  }

  if (payload.validadeHoras !== undefined) {
    const horas = Number(payload.validadeHoras);
    if (!Number.isInteger(horas) || horas < 1 || horas > 24 * 30) {
      throw new AppError("Validade do Pix deve ficar entre 1 hora e 30 dias.", 400);
    }
    data.validadeHoras = horas;
  }

  if (payload.contaDestinoId !== undefined) {
    data.contaDestinoId = payload.contaDestinoId ? Number(payload.contaDestinoId) : null;
  }

  if (payload.urlPublica !== undefined) {
    const url = String(payload.urlPublica || "").trim().replace(/\/+$/, "");
    if (url && !/^https:\/\/[^\s/]+/i.test(url)) {
      throw new AppError("A URL publica deve comecar com https://", 400);
    }
    data.urlPublica = url || null;
  }

  if (payload.ativo !== undefined) {
    data.ativo = Boolean(payload.ativo);
  }

  const apiKey = data.apiKey ?? atual?.apiKey;
  if (data.ativo && !apiKey) {
    throw new AppError("Informe a chave da API da SumUp antes de ativar.", 400);
  }

  // Token secreto que identifica o webhook (gerado uma unica vez).
  if (!atual?.webhookToken) {
    data.webhookToken = crypto.randomBytes(24).toString("hex");
  }

  await prisma.machinePaySumupConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  return getConfig();
}

/**
 * Chama a API da SumUp com a chave configurada.
 * @param {string} apiKey
 * @param {string} caminho
 * @param {{ method?: string, body?: object }} opcoes
 * @returns {Promise<any>}
 */
async function chamarSumup(apiKey, caminho, { method = "GET", body } = {}) {
  let resposta;
  try {
    resposta = await fetch(`${SUMUP_API}${caminho}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new AppError(`Nao foi possivel falar com a SumUp: ${error.message}`, 502);
  }

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch (_error) {
    dados = { message: texto };
  }

  if (!resposta.ok) {
    const detalhe = Array.isArray(dados)
      ? dados.map((e) => e.message || e.error_code).join("; ")
      : dados?.message || dados?.error_message || dados?.error_code || resposta.statusText;
    const status = resposta.status === 401 ? 400 : 502;
    throw new AppError(
      resposta.status === 401
        ? "A SumUp recusou a chave da API (401). Confira a chave na aba SumUp."
        : `SumUp respondeu ${resposta.status}: ${detalhe}`,
      status,
    );
  }

  return dados;
}

/**
 * Configuracao pronta para uso ou erro explicando o que falta.
 * @returns {Promise<object>}
 */
async function getConfigAtiva() {
  const config = await lerConfig();
  if (!config?.ativo || !config.apiKey) {
    throw new AppError("A integracao SumUp esta desativada. Configure na aba SumUp.", 409);
  }
  return config;
}

/**
 * Descobre o merchant_code da conta pela chave (GET /v0.1/me).
 * @param {string} apiKey
 * @returns {Promise<{ merchantCode: string|null, nome: string|null }>}
 */
async function lerConta(apiKey) {
  const me = await chamarSumup(apiKey, "/v0.1/me");
  const perfil = me?.merchant_profile || {};
  return {
    merchantCode: perfil.merchant_code || me?.merchant_code || null,
    nome: perfil.company_name || perfil.doing_business_as?.business_name || null,
  };
}

/**
 * Testa a chave, salva o merchant_code e lista as formas de pagamento
 * liberadas na conta (para confirmar se o Pix esta disponivel na API).
 * @param {object} user
 * @returns {Promise<object>}
 */
async function testarConexao(user) {
  const config = await lerConfig();
  if (!config?.apiKey) {
    throw new AppError("Salve a chave da API da SumUp antes de testar.", 400);
  }

  const conta = await lerConta(config.apiKey);
  const merchantCode = config.merchantCode || conta.merchantCode;

  if (!merchantCode) {
    throw new AppError("A SumUp nao informou o codigo do estabelecimento (merchant code).", 502);
  }

  let metodos = [];
  let erroMetodos = null;
  try {
    const resposta = await chamarSumup(
      config.apiKey,
      `/v0.1/merchants/${encodeURIComponent(merchantCode)}/payment-methods?amount=10&currency=BRL`,
    );
    metodos = (resposta?.available_payment_methods || resposta?.items || [])
      .map((m) => m.id)
      .filter(Boolean);
  } catch (error) {
    erroMetodos = error.message;
  }

  if (!config.merchantCode) {
    await prisma.machinePaySumupConfig.update({
      where: { id: 1 },
      data: { merchantCode, updatedBy: user?.email || null },
    });
  }

  return {
    ok: true,
    merchantCode,
    nomeConta: conta.nome,
    metodos,
    pixDisponivel: metodos.some((m) => TIPOS_PIX.includes(m)),
    erroMetodos,
  };
}

/**
 * Acha as instrucoes de pagamento (artefacts) na resposta da SumUp,
 * onde quer que venham (pix.artefacts, qr_code_pix.artefacts...).
 * @param {any} resposta
 * @returns {{ copiaCola: string|null, qrUrl: string|null }}
 */
function extrairArtefatos(resposta) {
  const artefatos = [];
  const visitar = (no) => {
    if (!no || typeof no !== "object") {
      return;
    }
    if (Array.isArray(no.artefacts)) {
      artefatos.push(...no.artefacts);
    }
    Object.values(no).forEach(visitar);
  };
  visitar(resposta);

  const codigo = artefatos.find((a) => a.name === "code" || a.content_type === "text/plain");
  const imagem = artefatos.find((a) => a.name === "barcode" || String(a.content_type).startsWith("image/"));

  return {
    copiaCola: codigo?.content || null,
    qrUrl: imagem?.location || null,
  };
}

/**
 * Desativa um checkout na SumUp (o Pix dele deixa de poder ser pago).
 * Ja expirado ou inexistente conta como desativado.
 * @param {string} apiKey
 * @param {string} checkoutId
 */
async function desativarCheckout(apiKey, checkoutId) {
  try {
    await chamarSumup(apiKey, `/v0.1/checkouts/${encodeURIComponent(checkoutId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (/respondeu (404|409)/.test(error.message)) {
      return;
    }
    throw new AppError(
      `Nao foi possivel cancelar o Pix anterior na SumUp, entao nao gerei outro (evita o cliente pagar dois). ${error.message}`,
      502,
    );
  }
}

/**
 * Formata a cobranca com os dados do Pix para a tela.
 * @param {object} cobranca
 * @returns {object}
 */
function respostaPix(cobranca) {
  return {
    cobrancaId: cobranca.id,
    checkoutId: cobranca.sumupCheckoutId,
    copiaCola: cobranca.pixCopiaCola,
    qrUrl: cobranca.pixQrUrl,
    geradoEm: cobranca.pixGeradoEm,
    validoAte: cobranca.pixValidoAte,
    status: cobranca.status,
    valor: Number(cobranca.valor),
  };
}

/**
 * Gera (ou reaproveita, se ainda valido e com o mesmo valor) o Pix dinamico
 * de uma cobranca. A referencia do checkout leva o id da cobranca, entao o
 * pagamento sempre volta para o cliente certo.
 * @param {number|string} cobrancaId
 * @param {{ novo?: boolean }} opcoes
 * @returns {Promise<object>}
 */
async function gerarPix(cobrancaId, { novo = false } = {}) {
  const config = await getConfigAtiva();
  const cobranca = await prisma.machinePayCobranca.findUnique({
    where: { id: Number(cobrancaId) },
    include: { cliente: true },
  });

  if (!cobranca) {
    throw new AppError("Cobranca nao encontrada.", 404);
  }
  if (cobranca.status !== "PENDENTE") {
    throw new AppError("So e possivel gerar Pix para cobrancas em aberto.", 409);
  }

  const valor = Number(cobranca.valor);
  if (!(valor > 0)) {
    throw new AppError("A cobranca precisa ter valor maior que zero.", 400);
  }

  // Antes de gerar outro, confere se o Pix atual ja foi pago.
  let statusAnterior = null;
  if (cobranca.sumupCheckoutId) {
    const conferido = await conferirCheckout(cobranca.sumupCheckoutId).catch(() => null);
    if (conferido?.baixado) {
      throw new AppError("Esta cobranca acabou de ser paga pelo Pix SumUp.", 409);
    }
    statusAnterior = conferido?.status ?? null;
  }

  const aindaValido =
    !novo &&
    cobranca.sumupCheckoutId &&
    cobranca.pixCopiaCola &&
    cobranca.pixValidoAte &&
    cobranca.pixValidoAte.getTime() - Date.now() > 30 * 60 * 1000 &&
    cobranca.sumupReferencia?.includes(`-v${Math.round(valor * 100)}-`);

  if (aindaValido) {
    return respostaPix(cobranca);
  }

  // Vai gerar um Pix novo: cancela o anterior na SumUp para o cliente nao
  // conseguir pagar os dois.
  if (cobranca.sumupCheckoutId && !["EXPIRED", "FAILED"].includes(statusAnterior)) {
    await desativarCheckout(config.apiKey, cobranca.sumupCheckoutId);
  }

  const merchantCode = config.merchantCode || (await lerConta(config.apiKey)).merchantCode;
  if (!merchantCode) {
    throw new AppError("Codigo do estabelecimento SumUp nao configurado. Use Testar conexao.", 400);
  }

  const validoAte = new Date(Date.now() + config.validadeHoras * 60 * 60 * 1000);
  const referencia = `mp-c${cobranca.id}-v${Math.round(valor * 100)}-${Date.now().toString(36)}`;
  const webhookUrl = montarWebhookUrl(config);

  const checkout = await chamarSumup(config.apiKey, "/v0.1/checkouts", {
    method: "POST",
    body: {
      checkout_reference: referencia,
      amount: valor,
      currency: "BRL",
      merchant_code: merchantCode,
      description: `Machine Pay ${cobranca.competencia} - ${cobranca.cliente.nome}`.slice(0, 255),
      valid_until: validoAte.toISOString(),
      ...(webhookUrl ? { return_url: webhookUrl } : {}),
    },
  });

  const documento = String(cobranca.cliente.documento || "").replace(/\D/g, "");
  const [primeiroNome, ...sobrenome] = String(cobranca.cliente.nome).trim().split(/\s+/);
  const personalDetails = {
    first_name: primeiroNome,
    last_name: sobrenome.join(" ") || primeiroNome,
    ...(cobranca.cliente.email ? { email: cobranca.cliente.email } : {}),
    ...(documento ? { tax_id: documento } : {}),
  };

  const processado = await chamarSumup(config.apiKey, `/v0.1/checkouts/${checkout.id}`, {
    method: "PUT",
    body: { payment_type: config.tipoPix, personal_details: personalDetails },
  });

  const { copiaCola, qrUrl } = extrairArtefatos(processado);
  if (!copiaCola && !qrUrl) {
    throw new AppError(
      "A SumUp criou a cobranca mas nao devolveu o QR Code Pix. Confira se o Pix esta liberado na API da sua conta.",
      502,
    );
  }

  const atualizada = await prisma.machinePayCobranca.update({
    where: { id: cobranca.id },
    data: {
      sumupCheckoutId: checkout.id,
      sumupReferencia: referencia,
      pixCopiaCola: copiaCola,
      pixQrUrl: qrUrl,
      pixGeradoEm: new Date(),
      pixValidoAte: validoAte,
    },
  });

  return respostaPix(atualizada);
}

/**
 * Consulta o checkout na SumUp e, se estiver pago, da baixa na cobranca
 * vinculada (lancando a entrada na conta escolhida na configuracao).
 * @param {string} checkoutId
 * @returns {Promise<{ status: string, baixado: boolean, cobrancaId: number|null }>}
 */
function conferirCheckout(checkoutId) {
  const chave = String(checkoutId);
  if (!conferenciasEmAndamento.has(chave)) {
    conferenciasEmAndamento.set(
      chave,
      executarConferencia(chave).finally(() => conferenciasEmAndamento.delete(chave)),
    );
  }
  return conferenciasEmAndamento.get(chave);
}

async function executarConferencia(checkoutId) {
  const config = await getConfigAtiva();
  const checkout = await chamarSumup(config.apiKey, `/v0.1/checkouts/${encodeURIComponent(checkoutId)}`);

  let cobranca = await prisma.machinePayCobranca.findUnique({
    where: { sumupCheckoutId: String(checkoutId) },
  });

  // Pix antigo pago depois de gerado um novo: a referencia (mp-c<id>-...)
  // ainda aponta a cobranca certa.
  const idDaReferencia = /^mp-c(\d+)-/.exec(checkout?.checkout_reference || "")?.[1];
  if (!cobranca && idDaReferencia) {
    cobranca = await prisma.machinePayCobranca.findUnique({
      where: { id: Number(idDaReferencia) },
    });
  }

  if (!cobranca) {
    return { status: checkout?.status, baixado: false, cobrancaId: null };
  }

  if (checkout?.status !== "PAID" || cobranca.status !== "PENDENTE") {
    return { status: checkout?.status, baixado: false, cobrancaId: cobranca.id };
  }

  const transacao = (checkout.transactions || []).find((t) => t.status === "SUCCESSFUL")
    || checkout.transactions?.[0];
  const pagoEm = transacao?.timestamp || checkout.date || new Date().toISOString();

  await machinePayService.pagarCobranca(cobranca.id, {
    valorPago: Number(checkout.amount ?? cobranca.valor),
    // Data do pagamento no fuso do Brasil.
    pagoEm: new Date(new Date(pagoEm).getTime() - 3 * 60 * 60 * 1000).toISOString(),
    formaPagamento: FORMA_PAGAMENTO,
    contaDestinoId: config.contaDestinoId || undefined,
  });

  console.log(`[sumup] baixa automatica da cobranca ${cobranca.id} (checkout ${checkoutId})`);
  return { status: checkout.status, baixado: true, cobrancaId: cobranca.id };
}

/**
 * Confere manualmente o Pix de uma cobranca (botao "Verificar pagamento").
 * @param {number|string} cobrancaId
 * @returns {Promise<object>}
 */
async function verificarPix(cobrancaId) {
  const cobranca = await prisma.machinePayCobranca.findUnique({
    where: { id: Number(cobrancaId) },
  });
  if (!cobranca?.sumupCheckoutId) {
    throw new AppError("Esta cobranca nao tem Pix SumUp gerado.", 404);
  }
  return conferirCheckout(cobranca.sumupCheckoutId);
}

/**
 * Recebe o aviso da SumUp. Responde rapido e confere o checkout em seguida;
 * o status sempre e lido da API, nunca do corpo do webhook.
 * @param {string} token
 * @param {object} body
 * @returns {Promise<void>}
 */
async function receberWebhook(token, body = {}) {
  const config = await lerConfig();
  const esperado = config?.webhookToken || "";
  const recebido = String(token || "");

  if (
    !esperado ||
    esperado.length !== recebido.length ||
    !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))
  ) {
    throw new AppError("Webhook nao autorizado.", 404);
  }

  const checkoutId = body.id || body.checkout_id || body.payload?.checkout_id;
  if (!checkoutId) {
    return;
  }

  conferirCheckout(String(checkoutId)).catch((error) =>
    console.error(`[sumup] webhook ${checkoutId} falhou:`, error.message),
  );
}

/**
 * Confere os Pix em aberto ainda dentro da validade (ou vencidos ha pouco),
 * para o caso de algum webhook nao ter chegado. Com todos, confere todo Pix
 * de cobranca em aberto (botao "Verificar Pix pagos").
 * @param {{ todos?: boolean }} opcoes
 * @returns {Promise<{ conferidos: number, baixas: number, pagos: string[], falhas: number }>}
 */
async function conferirPixPendentes({ todos = false } = {}) {
  const config = await lerConfig();
  if (!config?.ativo || !config.apiKey) {
    if (todos) {
      throw new AppError("A integracao SumUp esta desativada. Configure na aba Integrações.", 409);
    }
    return { conferidos: 0, baixas: 0, pagos: [], falhas: 0 };
  }

  const pendentes = await prisma.machinePayCobranca.findMany({
    where: {
      status: "PENDENTE",
      sumupCheckoutId: { not: null },
      ...(todos ? {} : { pixValidoAte: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    },
    select: { sumupCheckoutId: true, cliente: { select: { nome: true } } },
    take: todos ? 1000 : 200,
  });

  const pagos = [];
  let falhas = 0;
  for (const { sumupCheckoutId, cliente } of pendentes) {
    try {
      const r = await conferirCheckout(sumupCheckoutId);
      if (r.baixado) pagos.push(cliente.nome);
    } catch (error) {
      falhas += 1;
      console.error(`[sumup] conferencia ${sumupCheckoutId} falhou:`, error.message);
    }
  }
  return { conferidos: pendentes.length, baixas: pagos.length, pagos, falhas };
}

/**
 * Agenda a conferencia periodica dos Pix em aberto.
 */
function iniciarConferenciaAutomatica() {
  setInterval(() => {
    conferirPixPendentes().catch((error) =>
      console.error("[sumup] conferencia automatica falhou:", error.message),
    );
  }, INTERVALO_CONFERENCIA_MIN * 60 * 1000);
}

module.exports = {
  getConfig,
  updateConfig,
  testarConexao,
  gerarPix,
  verificarPix,
  conferirCheckout,
  receberWebhook,
  conferirPixPendentes,
  iniciarConferenciaAutomatica,
  extrairArtefatos,
};

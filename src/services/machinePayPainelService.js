const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

// Integracao com o painel Machine Pay (cyberpix): importa os clientes da
// revenda Machine Pay e o estado das maquinas de cada um. O painel nao tem
// API nem webhook, entao lemos o HTML das telas "Clientes" (usuarios.php) e
// "Dispositivos Cadastrados" (maquinas.php?acao=maquinas&usr=ID).

const DEFAULT_PAINEL_URL = "https://www.cyberpix.com.br/pix-adesivo-clientes/";
const REVENDA_MACHINE_PAY = "machine pay";
const DIAS_SEM_VENDA_INATIVA = 30;
const CONCORRENCIA = 6;
const FUSO_HORARIO = "America/Sao_Paulo";

/**
 * Indica se as credenciais do painel estao configuradas.
 * @returns {boolean}
 */
function painelConfigurado() {
  return Boolean(process.env.MACHINE_PAY_LOGIN && process.env.MACHINE_PAY_PASSWORD);
}

function baseUrl() {
  const url = process.env.MACHINE_PAY_PAINEL_URL || DEFAULT_PAINEL_URL;
  return url.endsWith("/") ? url : `${url}/`;
}

const base64 = (valor) => Buffer.from(String(valor), "utf8").toString("base64");

function extrairCookies(response) {
  const valores =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return valores.map((cookie) => cookie.split(";")[0]);
}

/**
 * Faz login no painel e devolve o header Cookie da sessao.
 * @returns {Promise<string>}
 */
async function login() {
  if (!painelConfigurado()) {
    throw new AppError(
      "Configure MACHINE_PAY_LOGIN e MACHINE_PAY_PASSWORD para integrar com o painel Machine Pay.",
      500,
    );
  }

  const inicial = await fetch(baseUrl(), { redirect: "manual" });
  const cookies = new Map(
    extrairCookies(inicial).map((c) => [c.split("=")[0], c]),
  );

  const url = new URL("index.php", baseUrl());
  url.searchParams.set("acao", "login");
  url.searchParams.set("usr", base64(process.env.MACHINE_PAY_LOGIN));
  url.searchParams.set("snh", base64(process.env.MACHINE_PAY_PASSWORD));

  const response = await fetch(url, {
    headers: {
      Cookie: [...cookies.values()].join("; "),
      Referer: baseUrl(),
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
  });
  for (const cookie of extrairCookies(response)) {
    cookies.set(cookie.split("=")[0], cookie);
  }
  const body = await response.text();

  if (!response.ok || /senha|login incorreto|acesso negado/i.test(body)) {
    throw new AppError("Falha ao autenticar no painel Machine Pay.", 502);
  }

  return [...cookies.values()].join("; ");
}

async function buscarPagina(cookie, caminho) {
  const response = await fetch(`${baseUrl()}${caminho}`, {
    headers: {
      Cookie: cookie,
      Referer: baseUrl(),
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (!response.ok) {
    throw new AppError(
      `Painel Machine Pay respondeu ${response.status} em ${caminho}.`,
      502,
    );
  }

  return response.text();
}

const limparHtml = (html) =>
  String(html || "")
    .replace(/<ul[\s\S]*?<\/ul>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const normalizar = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Le a tela "Clientes" (usuarios.php). Cada linha tem o ID do cliente
 * (copiarDadosCadastro), o nome, o WhatsApp e o logo da revenda.
 * @param {string} html
 * @returns {Array<{ usrId: string, nome: string, telefone: string|null, revenda: string|null }>}
 */
function parsearClientes(html) {
  const clientes = new Map();

  for (const linha of String(html).split(/<tr[\s>]/i).slice(1)) {
    const usrId = linha.match(/copiarDadosCadastro\((\d+)\)/)?.[1];
    if (!usrId || clientes.has(usrId)) continue;

    const nome = linha.match(
      /cliente-empresa\.png[^>]*>\s*<strong>([\s\S]*?)<\/strong>/,
    )?.[1];
    const revenda = linha.match(
      /<img src="[^"]+" alt="([^"]+)" style="width: ?110px;?"/,
    )?.[1];
    const telefone = linha.match(/wa\.me\/(\d+)/)?.[1] || null;

    clientes.set(usrId, {
      usrId,
      nome: limparHtml(nome) || `Cliente ${usrId}`,
      telefone: telefone ? telefone.replace(/^55(?=\d{10,11}$)/, "") : null,
      revenda: revenda || null,
    });
  }

  return [...clientes.values()];
}

/**
 * Data de hoje (AAAA-MM-DD) no fuso de Brasilia.
 * @param {Date} data
 * @returns {string}
 */
function diaBrasil(data = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_HORARIO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

function dataBrasilia(dia, hora) {
  return new Date(`${dia}T${hora}:00-03:00`);
}

/**
 * Ultima venda de uma maquina a partir dos blocos "Hoje", "Ontem" e "Ant."
 * (este ultimo traz dd/mm sem o ano).
 * @param {string} texto
 * @param {Date} agora
 * @returns {Date|null}
 */
function calcularUltimaVenda(texto, agora = new Date()) {
  const hoje = diaBrasil(agora);
  const vendaHoje = texto.match(/Hoje R\$\s*[\d.,]+\s+(\d{2}:\d{2})/);
  if (vendaHoje) return dataBrasilia(hoje, vendaHoje[1]);

  const vendaOntem = texto.match(/Ontem R\$\s*[\d.,]+\s+(\d{2}:\d{2})/);
  if (vendaOntem) {
    return dataBrasilia(diaBrasil(new Date(agora - 86400000)), vendaOntem[1]);
  }

  const anterior = texto.match(
    /Ant\. R\$\s*[\d.,]+\s+(\d{2})\/(\d{2})\s+(\d{2}:\d{2})/,
  );
  if (!anterior) return null;

  const [, dia, mes, hora] = anterior;
  let ano = Number(hoje.slice(0, 4));
  if (`${mes}-${dia}` > hoje.slice(5)) ano -= 1;
  return dataBrasilia(`${ano}-${mes}-${dia}`, hora);
}

/**
 * Le a tela "Dispositivos Cadastrados" de um cliente. A chave ON/OFF de cada
 * maquina e o checkbox do block_maq ("Bloquear / Desbloquear"): marcado = ON.
 * A celula de opcoes ("td_ops acao") aparece uma vez por maquina.
 * @param {string} html
 * @param {Date} agora
 * @returns {Array<object>}
 */
function parsearMaquinas(html, agora = new Date()) {
  const limite = new Date(agora - DIAS_SEM_VENDA_INATIVA * 86400000);
  const maquinas = new Map();

  for (const linha of String(html).split(/class="td_ops acao"/).slice(1)) {
    const posId = linha.match(/Caixa:\s*(\d+)/)?.[1];
    if (!posId || maquinas.has(posId)) continue;

    const chave = linha.match(
      /class="switch"[^>]*>\s*<input type="checkbox"(\s+checked)?/,
    );
    const ligada = chave ? Boolean(chave[1]) : true;
    const indicador = linha.match(/class="fa fa-[\w-]+ maq_(on|off)\b/)?.[1];
    const celulaPonto = linha.match(
      /<td[^>]*onclick="stats\(\d+\);?"[^>]*>([\s\S]*?)<img[^>]*cliente-empresa\.png/,
    );
    const ultimaVendaEm = calcularUltimaVenda(limparHtml(linha), agora);

    maquinas.set(posId, {
      posId,
      idPainel: linha.match(/mnu_op_maq\((\d+)/)?.[1] || null,
      nome: celulaPonto
        ? limparHtml(celulaPonto[1]).replace(/^Híbrido\s*/i, "").slice(0, 255) || null
        : null,
      ligada,
      online: indicador ? indicador === "on" : null,
      ultimaVendaEm,
      inativa: ligada && (!ultimaVendaEm || ultimaVendaEm < limite),
    });
  }

  return [...maquinas.values()];
}

/**
 * A listagem so mostra "Sem vendas recentes" sem dizer a janela; o extrato
 * do caixa (acao=stats) nos ultimos 30 dias confirma. Devolve a data da venda
 * mais recente do periodo ou null.
 * @param {string} cookie
 * @param {string} posId
 * @param {Date} agora
 * @returns {Promise<Date|null>}
 */
async function buscarUltimaVendaNoExtrato(cookie, posId, agora) {
  const inicio = diaBrasil(new Date(agora - DIAS_SEM_VENDA_INATIVA * 86400000));
  const fim = `${diaBrasil(agora)}T23:59`;
  const html = await buscarPagina(
    cookie,
    `maquinas.php?acao=stats&posid=${encodeURIComponent(posId)}` +
      `&dataini=${encodeURIComponent(base64(inicio))}` +
      `&datafim=${encodeURIComponent(base64(fim))}&chave=`,
  );

  const datas = [...html.matchAll(/✅\s*(\d{2})\/(\d{2})\/(\d{4})-(\d{2}:\d{2})/gu)]
    .map(([, dia, mes, ano, hora]) => dataBrasilia(`${ano}-${mes}-${dia}`, hora))
    .filter((data) => !Number.isNaN(data.getTime()));

  return datas.length ? new Date(Math.max(...datas)) : null;
}

async function emLotes(itens, tamanho, fn) {
  const resultados = new Array(itens.length);
  let proximo = 0;

  async function trabalhador() {
    while (proximo < itens.length) {
      const indice = proximo;
      proximo += 1;
      try {
        resultados[indice] = { ok: true, valor: await fn(itens[indice]) };
      } catch (error) {
        resultados[indice] = { ok: false, erro: error.message };
      }
    }
  }

  await Promise.all(Array.from({ length: tamanho }, trabalhador));
  return resultados;
}

/**
 * Le o painel inteiro: clientes da revenda Machine Pay e as maquinas de cada um.
 * @returns {Promise<{ clientes: Array<object>, ignorados: number, falhas: Array<object> }>}
 */
async function lerPainel({ verificarVendas = true } = {}) {
  const cookie = await login();
  const todos = parsearClientes(await buscarPagina(cookie, "usuarios.php"));

  if (!todos.length) {
    throw new AppError(
      "Nenhum cliente encontrado no painel Machine Pay (sessao expirada ou layout mudou).",
      502,
    );
  }

  const daRevenda = todos.filter(
    (cliente) => normalizar(cliente.revenda) === REVENDA_MACHINE_PAY,
  );
  const agora = new Date();
  const leituras = await emLotes(daRevenda, CONCORRENCIA, async (cliente) => {
    const html = await buscarPagina(
      cookie,
      `maquinas.php?acao=maquinas&usr=${encodeURIComponent(cliente.usrId)}`,
    );
    return parsearMaquinas(html, agora);
  });

  const clientes = [];
  const falhas = [];
  daRevenda.forEach((cliente, indice) => {
    const leitura = leituras[indice];
    if (leitura.ok) {
      clientes.push({ ...cliente, maquinas: leitura.valor });
    } else {
      falhas.push({ usrId: cliente.usrId, nome: cliente.nome, erro: leitura.erro });
      clientes.push({ ...cliente, maquinas: null });
    }
  });

  if (verificarVendas) {
    const semVendaNaListagem = clientes
      .flatMap((c) => c.maquinas || [])
      .filter((m) => m.ligada && !m.ultimaVendaEm);
    const extratos = await emLotes(semVendaNaListagem, CONCORRENCIA, (maquina) =>
      buscarUltimaVendaNoExtrato(cookie, maquina.posId, agora),
    );
    semVendaNaListagem.forEach((maquina, indice) => {
      const extrato = extratos[indice];
      if (extrato.ok && extrato.valor) {
        maquina.ultimaVendaEm = extrato.valor;
        maquina.inativa = false;
      } else if (!extrato.ok) {
        falhas.push({ posId: maquina.posId, erro: extrato.erro });
      }
    });
  }

  return { clientes, ignorados: todos.length - daRevenda.length, falhas };
}

function contarMaquinas(maquinas) {
  const ligadas = maquinas.filter((m) => m.ligada);
  return {
    ligadas: ligadas.length,
    off: maquinas.length - ligadas.length,
    onInativas: ligadas.filter((m) => m.inativa).length,
  };
}

/**
 * Sem verificarVendas (sincronizacao rapida), maquinas ja conhecidas mantem a
 * ultima venda/inativa da ultima verificacao completa; so a chave ON/OFF muda.
 */
function mesclarVendas(maquinas, anteriores, verificarVendas) {
  if (verificarVendas) return maquinas;

  return maquinas.map((maquina) => {
    const anterior = anteriores.get(maquina.posId);
    if (!anterior) return maquina;
    return {
      ...maquina,
      ultimaVendaEm: anterior.ultimaVendaEm,
      inativa: maquina.ligada && anterior.inativa,
    };
  });
}

/**
 * Aplica o estado do painel em um cliente: maquinas ON viram proprias (menos
 * as de plano 36 ja cadastradas), OFF viram maquinas off e as ON sem venda nos
 * ultimos 30 dias viram "on inativas". Mudancas de ON/OFF ficam no historico.
 */
async function aplicarCliente(existente, cliente, agora, anteriores, verificarVendas) {
  const dadosBase = {
    nome: cliente.nome,
    telefone: cliente.telefone || existente?.telefone || null,
    painelUsrId: cliente.usrId,
  };

  if (!cliente.maquinas) {
    // Falha ao ler as maquinas: atualiza so o cadastro, sem zerar contagens.
    if (existente) {
      await prisma.machinePayCliente.update({ where: { id: existente.id }, data: dadosBase });
      return "atualizado";
    }
    await prisma.machinePayCliente.create({ data: dadosBase });
    return "criado";
  }

  const maquinas = mesclarVendas(cliente.maquinas, anteriores, verificarVendas);
  const contagem = contarMaquinas(maquinas);
  const plano36 = existente?.maquinasPlano36 || 0;
  const data = {
    ...dadosBase,
    maquinasProprias: Math.max(0, contagem.ligadas - plano36),
    maquinasOff: contagem.off,
    maquinasOnInativas: contagem.onInativas,
    painelSincronizadoEm: agora,
  };

  const registro = existente
    ? { id: existente.id }
    : await prisma.machinePayCliente.create({ data, select: { id: true } });

  const ajustes = existente
    ? [
        ["PROPRIA", "maquinasProprias"],
        ["OFF", "maquinasOff"],
      ]
        .filter(([, campo]) => data[campo] !== existente[campo])
        .map(([tipo, campo]) => ({
          clienteId: existente.id,
          tipo,
          quantidade: data[campo] - existente[campo],
          motivo: "Sincronizacao com o painel Machine Pay (ON/OFF)",
          usuario: "painel-machinepay",
        }))
    : [];

  await prisma.$transaction([
    ...(existente
      ? [prisma.machinePayCliente.update({ where: { id: existente.id }, data })]
      : []),
    prisma.machinePayAjusteMaquina.createMany({ data: ajustes }),
    // Remove tambem posIds que estavam em outro cliente (maquina transferida).
    prisma.machinePayMaquina.deleteMany({
      where: {
        OR: [
          { clienteId: registro.id },
          { posId: { in: maquinas.map((m) => m.posId) } },
        ],
      },
    }),
    prisma.machinePayMaquina.createMany({
      data: maquinas.map((m) => ({ ...m, clienteId: registro.id })),
    }),
  ]);

  return existente ? "atualizado" : "criado";
}

let sincronizacaoEmAndamento = null;
let andamentoVerificaVendas = false;
let ultimaSincronizacao = null;
let ultimaVerificacaoVendas = null;

/**
 * Sincroniza os clientes do GK com o painel: cria os clientes novos da
 * revenda Machine Pay, atualiza maquinas ON/OFF/ON inativas e remove os
 * clientes que sairam do painel (ou da revenda). Quem tem pagamento lancado
 * no caixa e inativado em vez de apagado.
 * @param {{ origem?: string, verificarVendas?: boolean }} opcoes
 * @returns {Promise<object>}
 */
function sincronizarPainel(opcoes = {}) {
  const verificarVendas = opcoes.verificarVendas !== false;

  // Pedido completo durante uma rapida: espera a atual e roda a completa.
  if (sincronizacaoEmAndamento && verificarVendas && !andamentoVerificaVendas) {
    return sincronizacaoEmAndamento
      .catch(() => {})
      .then(() => sincronizarPainel(opcoes));
  }

  if (!sincronizacaoEmAndamento) {
    andamentoVerificaVendas = verificarVendas;
    sincronizacaoEmAndamento = executarSincronizacao({ ...opcoes, verificarVendas })
      .then((resultado) => {
        ultimaSincronizacao = resultado;
        return resultado;
      })
      .catch((error) => {
        ultimaSincronizacao = {
          ok: false,
          em: new Date(),
          origem: opcoes.origem || "manual",
          erro: error.message,
        };
        throw error;
      })
      .finally(() => {
        sincronizacaoEmAndamento = null;
      });
  }
  return sincronizacaoEmAndamento;
}

async function executarSincronizacao({ origem = "manual", verificarVendas = true } = {}) {
  const inicio = Date.now();
  const agora = new Date();
  const { clientes, ignorados, falhas } = await lerPainel({ verificarVendas });

  const [existentes, maquinasAnteriores] = await Promise.all([
    prisma.machinePayCliente.findMany({ where: { painelUsrId: { not: null } } }),
    prisma.machinePayMaquina.findMany({
      select: { posId: true, ultimaVendaEm: true, inativa: true },
    }),
  ]);
  const porUsr = new Map(existentes.map((c) => [c.painelUsrId, c]));
  const anteriores = new Map(maquinasAnteriores.map((m) => [m.posId, m]));
  const resumo = { criados: 0, atualizados: 0, removidos: 0, inativados: 0 };

  for (const cliente of clientes) {
    const tipo = await aplicarCliente(
      porUsr.get(cliente.usrId),
      cliente,
      agora,
      anteriores,
      verificarVendas,
    );
    resumo[tipo === "criado" ? "criados" : "atualizados"] += 1;
  }

  const noPainel = new Set(clientes.map((c) => c.usrId));
  for (const existente of existentes) {
    if (noPainel.has(existente.painelUsrId)) continue;

    const comLancamento = await prisma.machinePayCobranca.count({
      where: { clienteId: existente.id, movimentacaoId: { not: null } },
    });
    if (comLancamento) {
      if (existente.status !== "INATIVO") {
        await prisma.machinePayCliente.update({
          where: { id: existente.id },
          data: { status: "INATIVO" },
        });
        resumo.inativados += 1;
      }
    } else {
      await prisma.machinePayCliente.delete({ where: { id: existente.id } });
      resumo.removidos += 1;
    }
  }

  const maquinas = await prisma.machinePayMaquina.findMany({
    select: { ligada: true, inativa: true },
  });
  if (verificarVendas) ultimaVerificacaoVendas = agora;
  return {
    ok: true,
    em: agora,
    origem,
    verificouVendas: verificarVendas,
    duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
    clientesMachinePay: clientes.length,
    clientesOutrasRevendas: ignorados,
    ...resumo,
    maquinas: {
      total: maquinas.length,
      ...contarMaquinas(maquinas),
    },
    falhas,
  };
}

/**
 * Situacao da integracao (para a tela).
 * @returns {object}
 */
function getStatusSincronizacao() {
  return {
    configurado: painelConfigurado(),
    emAndamento: Boolean(sincronizacaoEmAndamento),
    intervaloMinutos: intervaloMinutos(),
    horaVerificacaoVendas: HORA_VERIFICACAO_VENDAS,
    ultimaVerificacaoVendas,
    ultima: ultimaSincronizacao,
  };
}

// Verificacao completa (vendas dos ultimos 30 dias) todo dia ao meio-dia.
const HORA_VERIFICACAO_VENDAS = 12;

function intervaloMinutos() {
  return Math.max(5, Number(process.env.MACHINE_PAY_SYNC_INTERVAL_MIN) || 15);
}

function horaBrasil(data = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FUSO_HORARIO,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(data),
  );
}

/**
 * Agenda as sincronizacoes automaticas: a rapida (clientes novos/excluidos e
 * ON/OFF) a cada MACHINE_PAY_SYNC_INTERVAL_MIN minutos (0 desliga) e a
 * completa, que recalcula as maquinas ON inativas, todo dia ao meio-dia.
 */
function iniciarSincronizacaoAutomatica() {
  if (!painelConfigurado()) {
    return;
  }

  const rodar = (verificarVendas) =>
    sincronizarPainel({ origem: "automatica", verificarVendas })
      .then((r) =>
        console.log(
          `[machinepay] sync ${verificarVendas ? "completa" : "rapida"}: ${r.criados} novos, ${r.atualizados} atualizados, ${r.removidos} removidos (${r.duracaoSegundos}s)`,
        ),
      )
      .catch((error) => console.error("[machinepay] sync falhou:", error.message));

  if (process.env.MACHINE_PAY_SYNC_INTERVAL_MIN !== "0") {
    setTimeout(() => rodar(false), 60 * 1000);
    setInterval(() => rodar(false), intervaloMinutos() * 60 * 1000);
  }

  // Confere a cada minuto; se o servidor estava fora ao meio-dia, roda assim que voltar.
  setInterval(() => {
    const feitaHoje =
      ultimaVerificacaoVendas && diaBrasil(ultimaVerificacaoVendas) === diaBrasil();
    if (!feitaHoje && horaBrasil() >= HORA_VERIFICACAO_VENDAS && !sincronizacaoEmAndamento) {
      rodar(true);
    }
  }, 60 * 1000);
}

module.exports = {
  painelConfigurado,
  parsearClientes,
  parsearMaquinas,
  lerPainel,
  sincronizarPainel,
  getStatusSincronizacao,
  iniciarSincronizacaoAutomatica,
};

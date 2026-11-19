// Sincronizacao dos clientes do CompactPay (produto COMPACTPAY do Machine Pay)
// pelo endpoint GET /integracao/grupogk/mensalidades, autenticado com X-Api-Key.
// O CompactPay manda o valor padrao por maquina e as faixas de valor de cada
// cliente; o GK guarda e calcula a mensalidade. Valores editados no GK
// (valoresPersonalizados) nao sao sobrescritos: so a quantidade de maquinas.

const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const machinePayService = require("./machinePayService");

const PRODUTO = "COMPACTPAY";
const URL_PADRAO = "https://compactpayback.onrender.com/api/v1";

let sincronizacaoEmAndamento = null;
let ultimaSincronizacao = null;
let timer = null;

/**
 * Endereco e chave da integracao: configuracao da tela, senao variaveis de ambiente.
 * @returns {Promise<{ url: string|null, chave: string|null }>}
 */
async function lerConexao() {
  const config = await machinePayService.lerConfigProduto(PRODUTO);
  return {
    url: (config.integracaoUrl || process.env.COMPACTPAY_API_URL || URL_PADRAO).replace(/\/+$/, ""),
    chave: config.integracaoKey || process.env.COMPACTPAY_API_KEY || null,
  };
}

async function configurado() {
  const { url, chave } = await lerConexao();
  return Boolean(url && chave);
}

/**
 * Busca as mensalidades no CompactPay.
 * @returns {Promise<Array<object>>}
 */
async function buscarMensalidades() {
  const { url, chave } = await lerConexao();
  if (!chave) {
    throw new AppError(
      "Configure a chave da integracao CompactPay em Configuracoes > Integracoes.",
      400,
    );
  }

  let resposta;
  try {
    resposta = await fetch(`${url}/integracao/grupogk/mensalidades`, {
      headers: { "X-Api-Key": chave, Accept: "application/json" },
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    throw new AppError(`Nao foi possivel falar com o CompactPay: ${error.message}`, 502);
  }

  if (resposta.status === 401) {
    throw new AppError("O CompactPay recusou a chave. Confira se e a mesma da GRUPOGK_API_KEY.", 502);
  }
  if (resposta.status === 503) {
    throw new AppError(
      "A integracao esta desligada no CompactPay: crie a variavel GRUPOGK_API_KEY no backend do CompactPay.",
      502,
    );
  }
  if (!resposta.ok) {
    throw new AppError(`CompactPay respondeu ${resposta.status}.`, 502);
  }

  const dados = await resposta.json().catch(() => null);
  if (!dados || !Array.isArray(dados.clientes)) {
    throw new AppError("Resposta do CompactPay sem a lista de clientes.", 502);
  }
  return dados.clientes;
}

/**
 * Converte o cliente do CompactPay para os campos do GK.
 * @param {object} c
 * @returns {object}
 */
function lerClienteCompactpay(c) {
  return {
    compactpayId: String(c.cliente_id),
    nome: String(c.nome_empresa || c.usuarios?.[0]?.nome || `Cliente ${c.cliente_id}`).trim(),
    email: c.email_contato || c.usuarios?.[0]?.email || null,
    valorPadrao: Number(c.valor_padrao) || 0,
    faixas: (Array.isArray(c.faixas) ? c.faixas : [])
      .map((f) => ({
        valor: Number(f.valor) || 0,
        quantidade: Math.max(0, Math.trunc(Number(f.quantidade_maquinas) || 0)),
        descricao: f.descricao ? String(f.descricao) : null,
      }))
      .filter((f) => f.quantidade > 0),
    maquinasTotal: Math.max(0, Math.trunc(Number(c.maquinas_total) || 0)),
    maquinasPadrao: Math.max(0, Math.trunc(Number(c.maquinas_padrao) || 0)),
    totalMensal: Number(c.total_mensal) || 0,
  };
}

/**
 * Aplica um cliente do CompactPay no GK.
 * @returns {Promise<"criado"|"atualizado">}
 */
async function aplicarCliente(existente, cp, agora) {
  const plano36 = existente?.maquinasPlano36 || 0;
  const parceria = existente?.maquinasParceria || 0;
  const personalizado = Boolean(existente?.valoresPersonalizados);

  const data = {
    // Nome e e-mail so no cadastro novo ou se estiverem vazios no GK.
    nome: existente?.nome || cp.nome,
    email: existente?.email || cp.email,
    produto: PRODUTO,
    compactpayId: cp.compactpayId,
    compactpaySincronizadoEm: agora,
  };

  if (personalizado) {
    // Valores do GK mantidos: so acompanha a quantidade de maquinas.
    const emFaixas = machinePayService.maquinasEmFaixas(existente);
    data.maquinasProprias = Math.max(0, cp.maquinasTotal - emFaixas - plano36 - parceria);
  } else {
    Object.assign(data, {
      valorMensalidade: cp.valorPadrao,
      valorFixo: null,
      faixas: cp.faixas.length ? cp.faixas : null,
      maquinasProprias: Math.max(0, cp.maquinasPadrao - plano36 - parceria),
    });
  }

  if (!existente) {
    await prisma.machinePayCliente.create({
      data: { ...data, faixas: data.faixas ?? undefined },
    });
    return "criado";
  }

  const ajustes =
    data.maquinasProprias !== existente.maquinasProprias
      ? [
          {
            clienteId: existente.id,
            tipo: "PROPRIA",
            quantidade: data.maquinasProprias - existente.maquinasProprias,
            motivo: "Sincronizacao com o CompactPay",
            usuario: "compactpay",
          },
        ]
      : [];

  await prisma.$transaction([
    prisma.machinePayCliente.update({
      where: { id: existente.id },
      data: {
        ...data,
        ...(data.faixas !== undefined
          ? { faixas: data.faixas ?? Prisma.DbNull }
          : {}),
      },
    }),
    prisma.machinePayAjusteMaquina.createMany({ data: ajustes }),
  ]);
  return "atualizado";
}

async function executarSincronizacao(origem) {
  const inicio = Date.now();
  const agora = new Date();
  const clientesCp = (await buscarMensalidades()).map(lerClienteCompactpay);

  const existentes = await prisma.machinePayCliente.findMany({
    where: { compactpayId: { not: null } },
  });
  const porId = new Map(existentes.map((c) => [c.compactpayId, c]));

  const resumo = { criados: 0, atualizados: 0, inativados: 0, falhas: [], maquinas: 0, totalMensal: 0 };
  for (const cp of clientesCp) {
    try {
      const resultado = await aplicarCliente(porId.get(cp.compactpayId), cp, agora);
      resumo[resultado === "criado" ? "criados" : "atualizados"] += 1;
      resumo.maquinas += cp.maquinasTotal;
      resumo.totalMensal += cp.totalMensal;
    } catch (error) {
      resumo.falhas.push({ cliente: cp.nome, erro: error.message });
    }
  }

  // Sumiu do CompactPay: fica inativo (o historico de cobrancas e mantido).
  const idsCp = new Set(clientesCp.map((c) => c.compactpayId));
  const sumiram = existentes.filter((c) => !idsCp.has(c.compactpayId) && c.status !== "INATIVO");
  if (sumiram.length) {
    const r = await prisma.machinePayCliente.updateMany({
      where: { id: { in: sumiram.map((c) => c.id) } },
      data: { status: "INATIVO" },
    });
    resumo.inativados = r.count;
  }

  resumo.totalMensal = Math.round(resumo.totalMensal * 100) / 100;
  ultimaSincronizacao = {
    origem,
    ok: true,
    em: new Date(),
    duracaoMs: Date.now() - inicio,
    clientes: clientesCp.length,
    ...resumo,
  };
  return ultimaSincronizacao;
}

/**
 * Sincroniza (uma por vez: chamada durante outra devolve a mesma).
 * @param {{ origem?: string }} opcoes
 * @returns {Promise<object>}
 */
function sincronizar({ origem = "manual" } = {}) {
  if (!sincronizacaoEmAndamento) {
    sincronizacaoEmAndamento = executarSincronizacao(origem)
      .catch((error) => {
        ultimaSincronizacao = { origem, ok: false, em: new Date(), erro: error.message };
        throw error;
      })
      .finally(() => {
        sincronizacaoEmAndamento = null;
      });
  }
  return sincronizacaoEmAndamento;
}

function intervaloMinutos() {
  const valor = Number(process.env.COMPACTPAY_SYNC_INTERVAL_MIN ?? 15);
  if (valor === 0) return 0;
  return Math.max(5, Number.isFinite(valor) ? valor : 15);
}

/**
 * Situacao para a tela (mesmo formato do painel Machine Pay).
 * @returns {Promise<object>}
 */
async function getStatusSincronizacao() {
  return {
    configurado: await configurado(),
    emAndamento: Boolean(sincronizacaoEmAndamento),
    intervaloMinutos: intervaloMinutos(),
    ultima: ultimaSincronizacao,
  };
}

/**
 * Testa a conexao (botao em Configuracoes > Integracoes).
 * @returns {Promise<{ ok: boolean, clientes: number, maquinas: number, totalMensal: number }>}
 */
async function testarConexao() {
  const clientes = (await buscarMensalidades()).map(lerClienteCompactpay);
  return {
    ok: true,
    clientes: clientes.length,
    comMaquinas: clientes.filter((c) => c.maquinasTotal > 0).length,
    maquinas: clientes.reduce((a, c) => a + c.maquinasTotal, 0),
    totalMensal: Math.round(clientes.reduce((a, c) => a + c.totalMensal, 0) * 100) / 100,
  };
}

/**
 * Sincronizacao automatica a cada COMPACTPAY_SYNC_INTERVAL_MIN minutos
 * (padrao 15, "0" desliga). Sem chave configurada, nao faz nada.
 */
function iniciarSincronizacaoAutomatica() {
  const minutos = intervaloMinutos();
  if (!minutos || timer) return;

  const rodar = async () => {
    try {
      if (await configurado()) await sincronizar({ origem: "automatica" });
    } catch (error) {
      console.error("[compactpay] sincronizacao automatica falhou:", error.message);
    }
  };

  setTimeout(rodar, 90 * 1000);
  timer = setInterval(rodar, minutos * 60 * 1000);
}

module.exports = {
  lerClienteCompactpay,
  sincronizar,
  getStatusSincronizacao,
  testarConexao,
  iniciarSincronizacaoAutomatica,
};

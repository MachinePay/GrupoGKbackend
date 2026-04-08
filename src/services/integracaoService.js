const {
  Prisma,
  MovimentacaoTipo,
  MovimentacaoStatus,
  MovimentacaoCategoria,
  TipoDespesa,
  AgendaTipo,
  AgendaStatus,
} = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

const AGARRAMAIS_SOURCE = "AGARRAMAIS_GASTO_FIXO";
const AGARRAMAIS_REPORT_SOURCE = "AGARRAMAIS_RELATORIO";
const AGARRAMAIS_GROSS_TROCADORA_SOURCE = "AGARRAMAIS_BRUTO_TROCADORA";
const AGARRAMAIS_GROSS_MAQUINAS_SOURCE = "AGARRAMAIS_BRUTO_MAQUINAS";
const AGARRAMAIS_CARD_FEE_SOURCE = "AGARRAMAIS_CUSTO_TAXA_CARTAO";
const AGARRAMAIS_VARIABLE_COST_SOURCE = "AGARRAMAIS_GASTO_VARIAVEL";
const AGARRAMAIS_PRODUCT_COST_SOURCE = "AGARRAMAIS_CUSTO_PRODUTOS";
const DEFAULT_REPORT_DAYS = 30;
const MAISQUIOSQUE_CUSTO_SOURCE = "MAISQUIOSQUE_CUSTO_GERAL";
const MAISQUIOSQUE_RECEITA_SOURCE = "MAISQUIOSQUE_RECEITA";
const MAISQUIOSQUE_CUSTO_PREAPROVADO_SOURCE = "MAISQUIOSQUE_CUSTO_PRE_APROVADO";

const FONTES_INTEGRACAO = [
  {
    id: "agarramais",
    nome: "AgarraMais",
    matchers: ["agarramais", "agarra mais"],
    syncDisponivel: true,
  },
  {
    id: "maisquiosque",
    nome: "MaisQuiosque",
    matchers: ["maisquiosque", "mais quiosque"],
    syncDisponivel: false,
  },
  {
    id: "girakids",
    nome: "GiraKids",
    matchers: ["girakids", "gira kids"],
    syncDisponivel: false,
  },
];

function isEnabledEnvFlag(key, defaultValue = false) {
  const rawValue = process.env[key];

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on", "sim"].includes(
    String(rawValue).trim().toLowerCase(),
  );
}

function isAgarraMaisConfigured() {
  return Boolean(
    process.env.AGARRAMAIS_API_URL &&
    process.env.AGARRAMAIS_EMAIL &&
    process.env.AGARRAMAIS_SENHA,
  );
}

function isMaisQuiosqueConfigured() {
  return Boolean(
    process.env.MAISQUIOSQUE_API_URL &&
    process.env.MAISQUIOSQUE_EMAIL &&
    process.env.MAISQUIOSQUE_PASSWORD,
  );
}

function getFontesAtivas() {
  return FONTES_INTEGRACAO.filter((fonte) => {
    if (fonte.id === "agarramais") {
      return isEnabledEnvFlag(
        "INTEGRACAO_AGARRAMAIS_ATIVA",
        isAgarraMaisConfigured(),
      );
    }

    if (fonte.id === "maisquiosque") {
      return isEnabledEnvFlag("INTEGRACAO_MAISQUIOSQUE_ATIVA", true);
    }

    if (fonte.id === "girakids") {
      return isEnabledEnvFlag("INTEGRACAO_GIRAKIDS_ATIVA", false);
    }

    return false;
  });
}

function getAgarraMaisConfig() {
  const apiUrl = process.env.AGARRAMAIS_API_URL;
  const email = process.env.AGARRAMAIS_EMAIL;
  const senha = process.env.AGARRAMAIS_SENHA;

  if (!apiUrl || !email || !senha) {
    throw new AppError(
      "Configure AGARRAMAIS_API_URL, AGARRAMAIS_EMAIL e AGARRAMAIS_SENHA para usar a integracao.",
      500,
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    email,
    senha,
    timeoutMs: Number(process.env.AGARRAMAIS_TIMEOUT_MS || 15000),
    lojaIdsPadrao: process.env.AGARRAMAIS_LOJA_IDS
      ? process.env.AGARRAMAIS_LOJA_IDS.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
  };
}

function getMaisQuiosqueConfig() {
  const apiUrl = process.env.MAISQUIOSQUE_API_URL;
  const email = process.env.MAISQUIOSQUE_EMAIL;
  const password =
    process.env.MAISQUIOSQUE_PASSWORD || process.env.MAISQUIOSQUE_SENHA;

  if (!apiUrl || !email || !password) {
    throw new AppError(
      "Configure MAISQUIOSQUE_API_URL, MAISQUIOSQUE_EMAIL e MAISQUIOSQUE_PASSWORD (ou MAISQUIOSQUE_SENHA) para usar a integração MaisQuiosque.",
      500,
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    email,
    password,
    timeoutMs: Number(process.env.MAISQUIOSQUE_TIMEOUT_MS || 15000),
  };
}

async function requestMaisQuiosque(
  path,
  { method = "GET", token, body, params, timeoutMs } = {},
) { 
  const config = getMaisQuiosqueConfig();
  const url = new URL(`${config.apiUrl}${path}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs || config.timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AppError(
      payload?.message ||
        payload?.error?.message ||
        payload?.error ||
        `Falha na API MaisQuiosque (${response.status}).`,
      502,
    );
  }

  return payload;
}

async function authenticateMaisQuiosque() {
  const config = getMaisQuiosqueConfig();
  const response = await requestMaisQuiosque("/api/auth/login", {
    method: "POST",
    body: {
      email: config.email,
      password: config.password,
    },
  });

  const token =
    response?.token ||
    response?.accessToken ||
    response?.data?.token ||
    response?.data?.accessToken ||
    response?.data?.data?.token ||
    response?.data?.data?.accessToken;

  if (!token) {
    throw new AppError(
      "A API MaisQuiosque não retornou token de autenticação.",
      502,
    );
  }

  return token;
}

async function fetchMaisQuiosqueAPI(options = {}) {
  const token = await authenticateMaisQuiosque();
  const { referenceMonth } = options;

  // Determina o mês de referência: usa o informado ou o mês anterior fechado
  let mesReferencia = referenceMonth;
  if (!mesReferencia) {
    const agora = new Date();
    const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    mesReferencia = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, "0")}`;
  }

  const params = { referenceMonth: mesReferencia };
  const payload = await requestMaisQuiosque("/api/logistics/fechamentos", {
    token,
    params,
  });

  const fechamentos = Array.isArray(payload?.data) ? payload.data : [];
  if (!fechamentos.length) {
    return { itens: [], periodo: { competencia: mesReferencia }, avisos: [] };
  }

  // Usa o fechamento mais recente para o mês
  const fechamento = fechamentos[fechamentos.length - 1];
  const itens = [];
  const dataReferencia = new Date(`${mesReferencia}-28T12:00:00`);

  if (Number(fechamento.custoGeralAtivo) > 0) {
    itens.push({
      id: `maisquiosque:custo-geral:${mesReferencia}`,
      descricao: `Custo Geral Ativo - MaisQuiosque`,
      detalhe: `Origem: Fechamento mensal | Competencia: ${mesReferencia}`,
      valor: Number(fechamento.custoGeralAtivo),
      data: dataReferencia,
      tipo: "CUSTO",
      origem: MAISQUIOSQUE_CUSTO_SOURCE,
    });
  }

  if (Number(fechamento.receitaVinculada) > 0) {
    itens.push({
      id: `maisquiosque:receita:${mesReferencia}`,
      descricao: `Receita Vinculada - MaisQuiosque`,
      detalhe: `Origem: Fechamento mensal | Competencia: ${mesReferencia}`,
      valor: Number(fechamento.receitaVinculada),
      data: dataReferencia,
      tipo: "RECEITA",
      origem: MAISQUIOSQUE_RECEITA_SOURCE,
    });
  }

  if (Number(fechamento.custosAplicadosPreAprovados) > 0) {
    itens.push({
      id: `maisquiosque:custo-pre-aprovado:${mesReferencia}`,
      descricao: `Custos Aplicados Pré-Aprovados - MaisQuiosque`,
      detalhe: `Origem: Fechamento mensal | Competencia: ${mesReferencia}`,
      valor: Number(fechamento.custosAplicadosPreAprovados),
      data: dataReferencia,
      tipo: "CUSTO",
      origem: MAISQUIOSQUE_CUSTO_PREAPROVADO_SOURCE,
    });
  }

  return {
    itens,
    periodo: { competencia: mesReferencia },
    avisos: [],
  };
}

async function syncMaisQuiosque(empresaId, usuarioId, options = {}) {
  try {
    const {
      itens: dadosExternos = [],
      avisos = [],
      periodo,
    } = await fetchMaisQuiosqueAPI(options);

    if (!dadosExternos.length) {
      return {
        sincronizados: 0,
        duplicados: 0,
        ignorados: 0,
        detalhes: [
          ...(avisos.length
            ? avisos
            : [
                {
                  status: "info",
                  mensagem: `Nenhum dado de fechamento disponível na MaisQuiosque para ${periodo?.competencia || "o período informado"}.`,
                },
              ]),
        ],
      };
    }

    const resultado = {
      sincronizados: 0,
      duplicados: 0,
      ignorados: 0,
      erros: 0,
      detalhes: [...avisos],
    };

    for (const item of dadosExternos) {
      try {
        const valorItem = Number(item.valor || 0);
        if (!(valorItem > 0)) {
          resultado.ignorados += 1;
          continue;
        }

        const jaExiste = await prisma.agenda.findFirst({
          where: { referenciaExternaId: item.id, empresaId },
        });

        if (jaExiste) {
          // Atualiza valor se mudou
          if (Number(jaExiste.valor) !== valorItem) {
            await prisma.agenda.update({
              where: { id: jaExiste.id },
              data: { valor: new Prisma.Decimal(valorItem) },
            });
          }
          resultado.duplicados += 1;
          resultado.detalhes.push({
            status: "duplicado",
            mensagem: `${item.descricao} já importado (valor atualizado se necessário)`,
            referenciaExterna: item.id,
          });
          continue;
        }

        const tipoAgenda =
          item.tipo === "RECEITA" ? AgendaTipo.RECEBER : AgendaTipo.PAGAR;

        const agendaCriada = await prisma.agenda.create({
          data: {
            data: item.data,
            titulo: item.descricao,
            descricao: `Importado automaticamente da MaisQuiosque | ${item.detalhe}`,
            valor: new Prisma.Decimal(valorItem),
            prioridade: "ALTA",
            status: AgendaStatus.PENDENTE_INTEGRACAO,
            tipo: tipoAgenda,
            origemExterna: true,
            referenciaExternaId: item.id,
            origem: item.origem,
            empresaId,
          },
        });

        resultado.sincronizados += 1;
        resultado.detalhes.push({
          status: "sucesso",
          mensagem: `${item.descricao} importado com sucesso`,
          agendaId: agendaCriada.id,
          referenciaExterna: item.id,
        });
      } catch (erro) {
        resultado.erros += 1;
        resultado.detalhes.push({
          status: "erro",
          mensagem: `Erro ao importar ${item.descricao}: ${erro.message}`,
          referenciaExterna: item.id,
        });
      }
    }

    return resultado;
  } catch (erro) {
    throw new AppError(
      `Erro ao sincronizar com MaisQuiosque: ${erro.message}`,
      500,
    );
  }
}

async function listarMaisQuiosqueFechamentos(options = {}) {
  try {
    const token = await authenticateMaisQuiosque();
    const payload = await requestMaisQuiosque("/api/logistics/fechamentos", {
      token,
      params: options.referenceMonth
        ? { referenceMonth: options.referenceMonth }
        : undefined,
    });

    return Array.isArray(payload?.data) ? payload.data : [];
  } catch (erro) {
    throw new AppError(
      `Erro ao listar fechamentos da MaisQuiosque: ${erro.message}`,
      500,
    );
  }
}

async function salvarMaisQuiosqueFechamento(payload) {
  try {
    const token = await authenticateMaisQuiosque();
    const response = await requestMaisQuiosque("/api/logistics/fechamentos", {
      method: "POST",
      token,
      body: payload,
    });

    return response?.data ?? null;
  } catch (erro) {
    throw new AppError(
      `Erro ao salvar fechamento da MaisQuiosque: ${erro.message}`,
      500,
    );
  }
}

function getPeriodoReferencia(dataInicio, dataFim) {
  let fim;
  let inicio;

  if (dataInicio || dataFim) {
    fim = dataFim ? new Date(`${dataFim}T23:59:59`) : new Date();
    inicio = dataInicio
      ? new Date(`${dataInicio}T00:00:00`)
      : new Date(new Date(fim).setDate(fim.getDate() - DEFAULT_REPORT_DAYS));
  } else {
    // Sem período informado, sincroniza o mês anterior fechado.
    const agora = new Date();
    const primeiroDiaMesAtual = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );

    fim = new Date(primeiroDiaMesAtual.getTime() - 1);
    inicio = new Date(fim.getFullYear(), fim.getMonth(), 1, 0, 0, 0, 0);
  }

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw new AppError("Periodo da integracao invalido.", 400);
  }

  return {
    inicio,
    fim,
    dataInicioIso: inicio.toISOString().slice(0, 10),
    dataFimIso: fim.toISOString().slice(0, 10),
    competencia: `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}`,
  };
}

function getAnoMesPeriodo(periodo) {
  const [ano, mes] = String(periodo.competencia).split("-");
  return {
    ano: Number(ano),
    mes: Number(mes),
  };
}

async function requestAgarraMais(
  path,
  { method = "GET", token, body, params, timeoutMs },
) {
  const config = getAgarraMaisConfig();
  const url = new URL(`${config.apiUrl}${path}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs || config.timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ||
        payload?.error ||
        payload?.message ||
        `Falha na API AgarraMais (${response.status}).`,
      502,
    );
  }

  return payload;
}

async function authenticateAgarraMais() {
  const config = getAgarraMaisConfig();
  const response = await requestAgarraMais("/api/auth/login", {
    method: "POST",
    body: {
      email: config.email,
      senha: config.senha,
    },
  });

  if (!response?.token) {
    throw new AppError(
      "A API AgarraMais nao retornou token de autenticacao.",
      502,
    );
  }

  return response.token;
}

function normalizarNomeDespesa(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapCategoria(nomeDespesa) {
  const nome = normalizarNomeDespesa(nomeDespesa);

  if (!nome) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
    };
  }

  if (nome.includes("ALUGUEL") || nome.includes("CONDOMINIO")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.DESPESAS_ADMINISTRATIVAS,
    };
  }

  if (
    nome.includes("FOLHA") ||
    nome.includes("SALARIO") ||
    nome.includes("FUNCIONARIO")
  ) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.FOLHA_PAGAMENTO,
    };
  }

  if (nome.includes("SOCIO")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.RETIRADA_SOCIOS,
    };
  }

  if (nome.includes("GASTO VARIAVEL") || nome.includes("GASTOS VARIAVEIS")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
    };
  }

  if (nome.includes("TAXA") && nome.includes("CARTAO")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.DESPESAS_DIVERSAS,
    };
  }

  if (nome.includes("CUSTO") && nome.includes("PRODUTO")) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.MATERIAL_ESTOQUE_EMBALAGENS,
    };
  }

  if (
    nome.includes("ENERG") ||
    nome.includes("LUZ") ||
    nome.includes("AGUA") ||
    nome.includes("INTERNET")
  ) {
    return {
      categoria: MovimentacaoCategoria.CUSTO_FIXO,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
    };
  }

  return {
    categoria: MovimentacaoCategoria.CUSTO_FIXO,
    tipoDespesa: TipoDespesa.DESPESAS_DIVERSAS,
  };
}

function construirDescricaoRelatorio(loja, dashboard) {
  const totais = dashboard?.totais || {};
  return [
    `Loja: ${loja.nome}`,
    `Faturamento: ${Number(totais.faturamento || 0).toFixed(2)}`,
    `Gasto fixo periodo: ${Number(totais.totalGastosFixos || 0).toFixed(2)}`,
    `Gasto variavel periodo: ${Number(totais.totalGastosVariaveis || 0).toFixed(2)}`,
    `Lucro operacional: ${Number(totais.lucroOperacional || 0).toFixed(2)}`,
  ].join(" | ");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPathValue(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (!acc || typeof acc !== "object") {
      return undefined;
    }

    return acc[key];
  }, obj);
}

function getMetricValue(obj, paths, fallback = 0) {
  for (const path of paths) {
    const rawValue = getPathValue(obj, path);
    const numberValue = toNumber(rawValue);
    if (numberValue !== null) {
      return numberValue;
    }
  }

  return fallback;
}

function construirDescricaoEntradaBruta({
  loja,
  origemLabel,
  total,
  dinheiro,
  cartaoPix,
  competencia,
}) {
  return [
    `Loja: ${loja.nome}`,
    `Origem: ${origemLabel}`,
    `Competencia: ${competencia}`,
    `Total bruto: ${Number(total || 0).toFixed(2)}`,
    `Dinheiro: ${Number(dinheiro || 0).toFixed(2)}`,
    `Cartao/Pix: ${Number(cartaoPix || 0).toFixed(2)}`,
  ].join(" | ");
}

function construirItensEntradasBrutas(
  loja,
  dashboard,
  periodo,
  relatorioDetalhado,
) {
  const itens = [];

  const totaisDetalhados = relatorioDetalhado?.totais || {};

  const trocadoraDinheiro = getMetricValue(
    dashboard,
    [
      "totais.valorDinheiroLoja",
      "trocadora.dinheiro",
      "trocadora.totalDinheiro",
      "resumo.trocadora.dinheiro",
      "totais.trocadoraDinheiro",
    ],
    Number(totaisDetalhados.valorDinheiroLoja || 0),
  );
  const trocadoraCartaoPix = getMetricValue(
    dashboard,
    [
      "totais.valorCartaoPixLoja",
      "trocadora.cartaoPix",
      "trocadora.cartao_pix",
      "trocadora.cartao",
      "resumo.trocadora.cartaoPix",
      "totais.trocadoraCartaoPix",
      "totais.trocadoraCartaoEPix",
    ],
    Number(totaisDetalhados.valorCartaoPixLoja || 0),
  );
  const trocadoraTotal = getMetricValue(
    dashboard,
    [
      "totais.valorTotalLojaBruto",
      "totais.valorBrutoConsolidadoLojaMaquinas",
      "trocadora.totalBruto",
      "trocadora.valorBruto",
      "trocadora.total",
      "resumo.trocadora.total",
      "totais.valorBrutoTrocadora",
      "totais.totalTrocadora",
    ],
    Number(totaisDetalhados.valorTotalLojaBruto || 0) ||
      trocadoraDinheiro + trocadoraCartaoPix,
  );

  if (trocadoraTotal > 0) {
    itens.push({
      id: `entrada-bruta:trocadora:${loja.id}:${periodo.competencia}`,
      descricao: `Valor bruto mensal vindo da Trocadora - ${loja.nome}`,
      detalhe: construirDescricaoEntradaBruta({
        loja,
        origemLabel: "Trocadora",
        total: trocadoraTotal,
        dinheiro: trocadoraDinheiro,
        cartaoPix: trocadoraCartaoPix,
        competencia: periodo.competencia,
      }),
      valor: trocadoraTotal,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "ENTRADA_BRUTA",
      categoria: null,
      tipoDespesa: null,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_GROSS_TROCADORA_SOURCE,
    });
  }

  const maquinasDinheiro = getMetricValue(
    dashboard,
    [
      "totais.valorDinheiroMaquinas",
      "maquinas.dinheiro",
      "maquinas.totalDinheiro",
      "resumo.maquinas.dinheiro",
      "totais.maquinasDinheiro",
    ],
    Number(totaisDetalhados.valorDinheiroMaquinas || 0),
  );
  const maquinasCartaoPix = getMetricValue(
    dashboard,
    [
      "totais.valorCartaoPixMaquinasBruto",
      "maquinas.cartaoPix",
      "maquinas.cartao_pix",
      "maquinas.cartao",
      "resumo.maquinas.cartaoPix",
      "totais.maquinasCartaoPix",
      "totais.maquinasCartaoEPix",
    ],
    Number(totaisDetalhados.valorCartaoPixMaquinasBruto || 0),
  );
  const maquinasTotal = getMetricValue(
    dashboard,
    [
      "totais.valorBrutoMaquinas",
      "maquinas.totalBruto",
      "maquinas.valorBruto",
      "maquinas.total",
      "resumo.maquinas.total",
      "totais.valorBrutoMaquinas",
      "totais.totalMaquinas",
      "totais.faturamento",
    ],
    Number(totaisDetalhados.valorBrutoMaquinas || 0) ||
      maquinasDinheiro + maquinasCartaoPix,
  );

  if (maquinasTotal > 0) {
    itens.push({
      id: `entrada-bruta:maquinas:${loja.id}:${periodo.competencia}`,
      descricao: `Valor bruto mensal vindo das Maquinas - ${loja.nome}`,
      detalhe: construirDescricaoEntradaBruta({
        loja,
        origemLabel: "Maquinas",
        total: maquinasTotal,
        dinheiro: maquinasDinheiro,
        cartaoPix: maquinasCartaoPix,
        competencia: periodo.competencia,
      }),
      valor: maquinasTotal,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "ENTRADA_BRUTA",
      categoria: null,
      tipoDespesa: null,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_GROSS_MAQUINAS_SOURCE,
    });
  }

  return itens;
}

function construirDescricaoCustoDashboard({
  loja,
  nomeCusto,
  competencia,
  valor,
  extras = [],
}) {
  return [
    `Loja: ${loja.nome}`,
    `Tipo: ${nomeCusto}`,
    `Competencia: ${competencia}`,
    `Valor: ${Number(valor || 0).toFixed(2)}`,
    ...extras.filter(Boolean),
  ].join(" | ");
}

function construirItensCustosDashboard(
  loja,
  dashboard,
  periodo,
  relatorioDetalhado,
) {
  const itens = [];

  const totaisDetalhados = relatorioDetalhado?.totais || {};

  const taxaMediaPercentual = getMetricValue(
    dashboard,
    [
      "totais.percentualTaxaCartaoMedia",
      "taxaMediaCartao.percentual",
      "taxaMediaCartao.taxa",
      "taxaCartao.percentual",
      "totais.taxaMediaCartao",
    ],
    Number(totaisDetalhados.percentualTaxaCartaoMedia || 0),
  );
  const taxaCartaoValor = getMetricValue(
    dashboard,
    [
      "totais.taxaDeCartao",
      "taxaMediaCartao.valorTaxas",
      "taxaMediaCartao.valorTaxasPeriodo",
      "taxaMediaCartao.custoTotal",
      "taxaCartao.valor",
      "totais.valorTaxasCartao",
      "totais.taxasCartao",
      "totais.custoTaxasCartao",
    ],
    Number(totaisDetalhados.taxaDeCartao || 0),
  );

  if (taxaCartaoValor > 0) {
    itens.push({
      id: `custo-taxa-cartao:${loja.id}:${periodo.competencia}`,
      descricao: `Custo mensal da taxa média de cartão - ${loja.nome}`,
      detalhe: construirDescricaoCustoDashboard({
        loja,
        nomeCusto: "Taxa média de cartão",
        competencia: periodo.competencia,
        valor: taxaCartaoValor,
        extras: [
          taxaMediaPercentual
            ? `Taxa media: ${Number(taxaMediaPercentual).toFixed(2)}%`
            : null,
        ],
      }),
      valor: taxaCartaoValor,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "CUSTO_DASHBOARD",
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.DESPESAS_DIVERSAS,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_CARD_FEE_SOURCE,
    });
  }

  const gastosVariaveis = getMetricValue(
    dashboard,
    [
      "totais.gastoVariavelTotalPeriodo",
      "totais.custoVariavelPeriodo",
      "gastosVariaveis.total",
      "gastosVariaveis.valor",
      "totais.totalGastosVariaveis",
      "totais.gastosVariaveis",
    ],
    Number(totaisDetalhados.gastoVariavelTotalPeriodo || 0) ||
      Number(totaisDetalhados.custoVariavelPeriodo || 0),
  );

  if (gastosVariaveis > 0) {
    itens.push({
      id: `gasto-variavel:${loja.id}:${periodo.competencia}`,
      descricao: `Gastos variáveis mensais - ${loja.nome}`,
      detalhe: construirDescricaoCustoDashboard({
        loja,
        nomeCusto: "Gastos variáveis",
        competencia: periodo.competencia,
        valor: gastosVariaveis,
      }),
      valor: gastosVariaveis,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "CUSTO_DASHBOARD",
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_VARIABLE_COST_SOURCE,
    });
  }

  const custoTotalProdutos = getMetricValue(
    dashboard,
    [
      "totais.gastoProdutosTotalPeriodo",
      "totais.custoProdutosTotal",
      "custosProdutos.total",
      "custosProdutos.valor",
      "produtos.custoTotal",
      "produtos.custoTotalProdutos",
      "totais.custoTotalProdutos",
      "totais.custosProdutos",
    ],
    Number(totaisDetalhados.gastoProdutosTotalPeriodo || 0) ||
      Number(totaisDetalhados.custoProdutosTotal || 0),
  );
  const produtosSaidos = getMetricValue(dashboard, [
    "produtos.qtdSaida",
    "produtos.quantidadeSaida",
    "totais.produtosSaidos",
  ]);

  if (custoTotalProdutos > 0) {
    itens.push({
      id: `custo-produtos:${loja.id}:${periodo.competencia}`,
      descricao: `Custo total de produtos no mês - ${loja.nome}`,
      detalhe: construirDescricaoCustoDashboard({
        loja,
        nomeCusto: "Custo total de produtos",
        competencia: periodo.competencia,
        valor: custoTotalProdutos,
        extras: [
          produtosSaidos ? `Produtos sairam: ${Number(produtosSaidos)}` : null,
        ],
      }),
      valor: custoTotalProdutos,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "CUSTO_DASHBOARD",
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.MATERIAL_ESTOQUE_EMBALAGENS,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_PRODUCT_COST_SOURCE,
    });
  }

  return itens;
}

async function fetchFechamentoMensalAgarraMais(token, lojaId, periodo) {
  const { ano, mes } = getAnoMesPeriodo(periodo);

  const response = await requestAgarraMais(
    "/api/fechamentos-mensais-relatorio",
    {
      token,
      params: {
        lojaId,
        ano,
        mes,
      },
    },
  );

  const fechamentos = Array.isArray(response?.fechamentos)
    ? response.fechamentos
    : [];

  if (!fechamentos.length) {
    return null;
  }

  const fechamento = fechamentos.find(
    (item) => Number(item?.ano) === ano && Number(item?.mes) === mes,
  );

  return fechamento || fechamentos[0] || null;
}

function construirItensDoFechamentoMensal(loja, fechamento, periodo) {
  const itens = [];
  const fechamentoId = fechamento?.id || `${loja.id}:${periodo.competencia}`;

  const valorTrocadoraDinheiroBruto =
    toNumber(fechamento?.valorTrocadoraDinheiroBruto) || 0;
  const valorTrocadoraCartaoPixBruto =
    toNumber(fechamento?.valorTrocadoraCartaoPixBruto) || 0;
  const valorTrocadoraBruto =
    valorTrocadoraDinheiroBruto + valorTrocadoraCartaoPixBruto;

  if (valorTrocadoraBruto > 0) {
    itens.push({
      id: `fechamento:entrada-bruta:trocadora:${fechamentoId}`,
      descricao: `Valor bruto mensal vindo da Trocadora - ${loja.nome}`,
      detalhe: construirDescricaoEntradaBruta({
        loja,
        origemLabel: "Trocadora",
        total: valorTrocadoraBruto,
        dinheiro: valorTrocadoraDinheiroBruto,
        cartaoPix: valorTrocadoraCartaoPixBruto,
        competencia: periodo.competencia,
      }),
      valor: valorTrocadoraBruto,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "ENTRADA_BRUTA",
      categoria: null,
      tipoDespesa: null,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_GROSS_TROCADORA_SOURCE,
    });
  }

  const valorMaquinasDinheiroBruto =
    toNumber(fechamento?.valorMaquinasDinheiroBruto) || 0;
  const valorMaquinasCartaoPixBruto =
    toNumber(fechamento?.valorMaquinasCartaoPixBruto) || 0;
  const valorMaquinasBruto =
    valorMaquinasDinheiroBruto + valorMaquinasCartaoPixBruto;

  if (valorMaquinasBruto > 0) {
    itens.push({
      id: `fechamento:entrada-bruta:maquinas:${fechamentoId}`,
      descricao: `Valor bruto mensal vindo das Maquinas - ${loja.nome}`,
      detalhe: construirDescricaoEntradaBruta({
        loja,
        origemLabel: "Maquinas",
        total: valorMaquinasBruto,
        dinheiro: valorMaquinasDinheiroBruto,
        cartaoPix: valorMaquinasCartaoPixBruto,
        competencia: periodo.competencia,
      }),
      valor: valorMaquinasBruto,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "ENTRADA_BRUTA",
      categoria: null,
      tipoDespesa: null,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_GROSS_MAQUINAS_SOURCE,
    });
  }

  const taxaCartaoValor = toNumber(fechamento?.taxaCartaoValor) || 0;
  const taxaCartaoPercentualMedia =
    toNumber(fechamento?.taxaCartaoPercentualMedia) || 0;

  if (taxaCartaoValor > 0) {
    itens.push({
      id: `fechamento:custo-taxa-cartao:${fechamentoId}`,
      descricao: `Custo mensal da taxa média de cartão - ${loja.nome}`,
      detalhe: construirDescricaoCustoDashboard({
        loja,
        nomeCusto: "Taxa média de cartão",
        competencia: periodo.competencia,
        valor: taxaCartaoValor,
        extras: [
          taxaCartaoPercentualMedia
            ? `Taxa media: ${Number(taxaCartaoPercentualMedia).toFixed(2)}%`
            : null,
        ],
      }),
      valor: taxaCartaoValor,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "CUSTO_DASHBOARD",
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.DESPESAS_DIVERSAS,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_CARD_FEE_SOURCE,
    });
  }

  const gastoVariavelTotal = toNumber(fechamento?.gastoVariavelTotal) || 0;

  if (gastoVariavelTotal > 0) {
    itens.push({
      id: `fechamento:gasto-variavel:${fechamentoId}`,
      descricao: `Gastos variáveis mensais - ${loja.nome}`,
      detalhe: construirDescricaoCustoDashboard({
        loja,
        nomeCusto: "Gastos variáveis",
        competencia: periodo.competencia,
        valor: gastoVariavelTotal,
      }),
      valor: gastoVariavelTotal,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "CUSTO_DASHBOARD",
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.CUSTOS_OPERACIONAIS,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_VARIABLE_COST_SOURCE,
    });
  }

  const gastoProdutosTotal = toNumber(fechamento?.gastoProdutosTotal) || 0;
  const produtosSaidos = Number(fechamento?.produtosSairam || 0);

  if (gastoProdutosTotal > 0) {
    itens.push({
      id: `fechamento:custo-produtos:${fechamentoId}`,
      descricao: `Custo total de produtos no mês - ${loja.nome}`,
      detalhe: construirDescricaoCustoDashboard({
        loja,
        nomeCusto: "Custo total de produtos",
        competencia: periodo.competencia,
        valor: gastoProdutosTotal,
        extras: [produtosSaidos ? `Produtos sairam: ${produtosSaidos}` : null],
      }),
      valor: gastoProdutosTotal,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "CUSTO_DASHBOARD",
      categoria: MovimentacaoCategoria.CUSTO_VARIAVEL,
      tipoDespesa: TipoDespesa.MATERIAL_ESTOQUE_EMBALAGENS,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_PRODUCT_COST_SOURCE,
    });
  }

  const gastosFixosDetalhados = Array.isArray(fechamento?.gastosFixosDetalhados)
    ? fechamento.gastosFixosDetalhados
    : [];

  for (const gasto of gastosFixosDetalhados) {
    const valor = toNumber(gasto?.valor) || 0;
    if (!(valor > 0)) continue;

    const nome = String(gasto?.nome || "Gasto fixo").trim();
    const classificacao = mapCategoria(nome);

    itens.push({
      id: `fechamento:gasto-fixo:${fechamentoId}:${gasto?.id || nome}`,
      descricao: `${nome} - ${loja.nome}`,
      detalhe: `Loja: ${loja.nome} | Origem: Fechamento mensal | Competencia: ${periodo.competencia}`,
      valor,
      data: new Date(`${periodo.dataFimIso}T12:00:00`),
      tipo: "GASTO_FIXO",
      categoria: classificacao.categoria,
      tipoDespesa: classificacao.tipoDespesa,
      lojaId: loja.id,
      lojaNome: loja.nome,
      origem: AGARRAMAIS_SOURCE,
    });
  }

  if (!gastosFixosDetalhados.length) {
    const gastoFixoTotal = toNumber(fechamento?.gastoFixoTotal) || 0;
    if (gastoFixoTotal > 0) {
      const classificacao = mapCategoria("Gastos fixos do mes");
      itens.push({
        id: `fechamento:gasto-fixo-total:${fechamentoId}`,
        descricao: `Gastos fixos totais no mês - ${loja.nome}`,
        detalhe: `Loja: ${loja.nome} | Origem: Fechamento mensal | Competencia: ${periodo.competencia}`,
        valor: gastoFixoTotal,
        data: new Date(`${periodo.dataFimIso}T12:00:00`),
        tipo: "GASTO_FIXO",
        categoria: classificacao.categoria,
        tipoDespesa: classificacao.tipoDespesa,
        lojaId: loja.id,
        lojaNome: loja.nome,
        origem: AGARRAMAIS_SOURCE,
      });
    }
  }

  return itens;
}

/**
 * Busca dados da integração AgarraMais exclusivamente via fechamento mensal.
 * @param {object} options Opcoes de sincronizacao.
 * @returns {Promise<{itens: Array<object>, avisos: Array<object>, periodo: object}>}
 */
async function fetchAgarraMaisAPI(options = {}) {
  const token = await authenticateAgarraMais();
  const periodo = getPeriodoReferencia(options.dataInicio, options.dataFim);
  const lojasSelecionadas = new Set(
    (options.lojaIds?.length
      ? options.lojaIds
      : getAgarraMaisConfig().lojaIdsPadrao
    ).map(String),
  );

  const lojas = await requestAgarraMais("/api/lojas", { token });
  const lojasFiltradas = Array.isArray(lojas)
    ? lojas.filter(
        (loja) =>
          !lojasSelecionadas.size || lojasSelecionadas.has(String(loja.id)),
      )
    : [];

  const itens = [];
  const avisos = [];

  for (const loja of lojasFiltradas) {
    try {
      const fechamentoMensal = await fetchFechamentoMensalAgarraMais(
        token,
        loja.id,
        periodo,
      );

      if (fechamentoMensal) {
        itens.push(
          ...construirItensDoFechamentoMensal(loja, fechamentoMensal, periodo),
        );
        continue;
      }

      avisos.push({
        status: "aviso",
        lojaId: loja.id,
        lojaNome: loja.nome,
        mensagem: `Nao existe fechamento mensal na AgarraMais para a loja ${loja.nome} em ${periodo.competencia}.`,
      });
    } catch (_error) {
      avisos.push({
        status: "aviso",
        lojaId: loja.id,
        lojaNome: loja.nome,
        mensagem: `Nao foi possivel consultar o fechamento mensal da loja ${loja.nome} em ${periodo.competencia}.`,
      });
    }
  }

  return {
    itens,
    avisos,
    periodo,
  };
}

/**
 * Sincroniza dados da AgarraMais com o sistema, criando itens de agenda pendentes.
 * @param {number} empresaId ID da empresa para importar dados
 * @param {number} usuarioId ID do usuário que dispara a sincronização (auditoria)
 * @returns {Promise<{sincronizados: number, duplicados: number, ignorados: number, removidosValorZero: number, detalhes: Array}>}
 */
async function syncAgarraMais(empresaId, usuarioId, options = {}) {
  try {
    const limpeza = await prisma.agenda.deleteMany({
      where: {
        empresaId,
        origemExterna: true,
        status: AgendaStatus.PENDENTE_INTEGRACAO,
        valor: { lte: 0 },
      },
    });

    const {
      itens: dadosExternos = [],
      avisos = [],
      periodo,
    } = await fetchAgarraMaisAPI(options);

    // Remove pendências legadas do mesmo período (importações antigas não baseadas em fechamento mensal).
    const limpezaLegadoPeriodo =
      periodo?.inicio && periodo?.fim
        ? await prisma.agenda.deleteMany({
            where: {
              empresaId,
              origemExterna: true,
              status: AgendaStatus.PENDENTE_INTEGRACAO,
              data: {
                gte: periodo.inicio,
                lte: periodo.fim,
              },
              referenciaExternaId: {
                not: {
                  startsWith: "fechamento:",
                },
              },
            },
          })
        : { count: 0 };

    if (!dadosExternos.length) {
      return {
        sincronizados: 0,
        duplicados: 0,
        ignorados: 0,
        removidosValorZero: limpeza.count,
        removidosLegadoPeriodo: limpezaLegadoPeriodo.count,
        detalhes: [
          ...(avisos.length
            ? avisos
            : [
                {
                  status: "info",
                  mensagem: `Nenhum dado de fechamento mensal disponivel na AgarraMais para ${periodo?.competencia || "o periodo informado"}.`,
                },
              ]),
        ],
      };
    }

    const resultado = {
      sincronizados: 0,
      duplicados: 0,
      ignorados: 0,
      removidosValorZero: limpeza.count,
      removidosLegadoPeriodo: limpezaLegadoPeriodo.count,
      erros: 0,
      detalhes: [...avisos],
    };

    // Processa cada item externo
    for (const item of dadosExternos) {
      try {
        const valorItem = Number(item.valor || 0);
        if (!(valorItem > 0)) {
          resultado.ignorados += 1;
          resultado.detalhes.push({
            status: "ignorado",
            mensagem: `Item ${item.descricao} ignorado por valor igual ou menor que zero`,
            referenciaExterna: item.id,
          });
          continue;
        }

        const jaExiste = await prisma.agenda.findFirst({
          where: {
            referenciaExternaId: item.id,
            empresaId,
          },
        });

        if (jaExiste) {
          resultado.duplicados += 1;
          resultado.detalhes.push({
            status: "duplicado",
            mensagem: `Item ${item.descricao} já foi importado anteriormente`,
            referenciaExterna: item.id,
          });
          continue;
        }

        const agendaCriada = await prisma.agenda.create({
          data: {
            data: item.data,
            titulo: item.descricao,
            descricao: [
              `Importado automaticamente da AgarraMais`,
              item.lojaNome ? `Loja: ${item.lojaNome}` : null,
              item.detalhe,
            ]
              .filter(Boolean)
              .join(" | "),
            valor: new Prisma.Decimal(valorItem),
            prioridade: "ALTA",
            status: AgendaStatus.PENDENTE_INTEGRACAO,
            tipo:
              item.tipo === "RELATORIO" || item.tipo === "ENTRADA_BRUTA"
                ? AgendaTipo.RECEBER
                : AgendaTipo.PAGAR,
            origemExterna: true,
            referenciaExternaId: item.id,
            origem: item.origem,
            empresaId,
          },
        });

        resultado.sincronizados += 1;
        resultado.detalhes.push({
          status: "sucesso",
          mensagem: `Item ${item.descricao} importado com sucesso`,
          agendaId: agendaCriada.id,
          referenciaExterna: item.id,
        });
      } catch (erro) {
        resultado.erros += 1;
        resultado.detalhes.push({
          status: "erro",
          mensagem: `Erro ao importar ${item.descricao}: ${erro.message}`,
          referenciaExterna: item.id,
        });
      }
    }

    return resultado;
  } catch (erro) {
    throw new AppError(
      `Erro ao sincronizar com AgarraMais: ${erro.message}`,
      500,
    );
  }
}

/**
 * Aprova um item pendente da integração e o converte em movimentação real.
 * @param {number} agendaId ID do item de agenda a aprovar
 * @param {number} usuarioId ID do usuário aprovador
 * @param {object} opcoes Opções adicionais para ajustes
 * @returns {Promise<{agendaId: number, movimentacaoId: number}>}
 */
async function aprovarPendencia(agendaId, usuarioId, opcoes = {}) {
  try {
    const item = await prisma.agenda.findUnique({
      where: { id: agendaId },
      include: { empresa: true },
    });

    if (!item) {
      throw new AppError("Item de agenda não encontrado", 404);
    }

    if (!item.origemExterna) {
      throw new AppError("Apenas itens da integração podem ser aprovados", 400);
    }

    if (!item.referenciaExternaId) {
      throw new AppError("Item não possui referência externa válida", 400);
    }

    const valorFinal = opcoes.valorAjustado
      ? new Prisma.Decimal(opcoes.valorAjustado)
      : item.valor;
    const classificacaoPadrao = mapCategoria(item.titulo);
    const categoriaFinal =
      opcoes.categoriaAjustada || classificacaoPadrao.categoria;
    const tipoDespesaFinal =
      opcoes.tipoDespesaAjustada || classificacaoPadrao.tipoDespesa;

    if (item.origem === AGARRAMAIS_REPORT_SOURCE) {
      await prisma.agenda.update({
        where: { id: agendaId },
        data: {
          status: AgendaStatus.REALIZADO,
          usuarioAprovadorId: usuarioId,
          dataAprovacao: new Date(),
        },
      });

      return { agendaId, movimentacaoId: null, revisado: true };
    }

    let contaOrigemId = null;
    let contaDestinoId = null;

    if (item.tipo === AgendaTipo.PAGAR) {
      // Para pagamentos, precisa da conta origem
      contaOrigemId = opcoes.contaId || null;
    } else {
      // Para recebimentos, conta destino
      contaDestinoId = opcoes.contaId || null;
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const movimentacao = await tx.movimentacao.create({
        data: {
          data: new Date(item.data),
          valor: valorFinal,
          tipo:
            item.tipo === AgendaTipo.PAGAR
              ? MovimentacaoTipo.SAIDA
              : MovimentacaoTipo.ENTRADA,
          categoria: item.tipo === AgendaTipo.PAGAR ? categoriaFinal : null,
          tipoDespesa: item.tipo === AgendaTipo.PAGAR ? tipoDespesaFinal : null,
          referencia: `Aprovado via AgarraMais - ${item.referenciaExternaId}`,
          status: MovimentacaoStatus.REALIZADO,
          canalOrigem: "AGARRAMAIS",
          empresaId: item.empresaId,
          contaOrigemId,
          contaDestinoId,
        },
      });

      if (contaOrigemId) {
        await tx.contaBancaria.update({
          where: { id: contaOrigemId },
          data: {
            saldoAtual: {
              decrement: valorFinal,
            },
          },
        });
      } else if (contaDestinoId) {
        await tx.contaBancaria.update({
          where: { id: contaDestinoId },
          data: {
            saldoAtual: {
              increment: valorFinal,
            },
          },
        });
      }

      await tx.agenda.update({
        where: { id: agendaId },
        data: {
          status: AgendaStatus.REALIZADO,
          usuarioAprovadorId: usuarioId,
          dataAprovacao: new Date(),
        },
      });

      return { agendaId, movimentacaoId: movimentacao.id };
    });

    return resultado;
  } catch (erro) {
    if (erro instanceof AppError) {
      throw erro;
    }
    throw new AppError(`Erro ao aprovar pendência: ${erro.message}`, 500);
  }
}

/**
 * Rejeita um item pendente da integração (deleta sem criar movimentação).
 * @param {number} agendaId ID do item de agenda
 * @param {string} motivo Motivo da rejeição para auditoria
 * @returns {Promise<void>}
 */
async function rejeitarPendencia(agendaId, motivo) {
  try {
    const item = await prisma.agenda.findUnique({
      where: { id: agendaId },
    });

    if (!item) {
      throw new AppError("Item de agenda não encontrado", 404);
    }

    if (!item.origemExterna) {
      throw new AppError(
        "Apenas itens da integração podem ser rejeitados",
        400,
      );
    }

    await prisma.agenda.update({
      where: { id: agendaId },
      data: {
        status: AgendaStatus.ATRASADO,
        descricao: `[REJEITADO] ${item.descricao}. Motivo: ${motivo}`,
      },
    });
  } catch (erro) {
    if (erro instanceof AppError) {
      throw erro;
    }
    throw new AppError(`Erro ao rejeitar pendência: ${erro.message}`, 500);
  }
}

/**
 * Lista todos os itens pendentes de integração de uma empresa.
 * @param {number} empresaId ID da empresa
 * @returns {Promise<Array<object>>}
 */
async function listarPendencias(empresaId) {
  try {
    const pendencias = await prisma.agenda.findMany({
      where: {
        empresaId,
        origemExterna: true,
        status: AgendaStatus.PENDENTE_INTEGRACAO,
        valor: { gt: 0 },
      },
      include: {
        empresa: { select: { id: true, nome: true } },
      },
      orderBy: { data: "asc" },
    });

    return pendencias.map((item) => ({
      ...item,
      classificacaoExterna:
        item.origem === AGARRAMAIS_REPORT_SOURCE
          ? "RELATORIO"
          : item.origem === AGARRAMAIS_GROSS_TROCADORA_SOURCE ||
              item.origem === AGARRAMAIS_GROSS_MAQUINAS_SOURCE
            ? "ENTRADA_BRUTA"
            : item.origem === AGARRAMAIS_CARD_FEE_SOURCE ||
                item.origem === AGARRAMAIS_VARIABLE_COST_SOURCE ||
                item.origem === AGARRAMAIS_PRODUCT_COST_SOURCE
              ? "CUSTO_DASHBOARD"
              : "GASTO_FIXO",
      permiteAprovacaoFinanceira: item.origem !== AGARRAMAIS_REPORT_SOURCE,
    }));
  } catch (erro) {
    throw new AppError(`Erro ao listar pendências: ${erro.message}`, 500);
  }
}

/**
 * Obtém estatísticas de pendências de um dia ou período.
 * @param {number} empresaId ID da empresa
 * @param {Date} dataInicio Data início
 * @param {Date} dataFim Data fim
 * @returns {Promise<{totalPendentes: number, valorTotal: Decimal, porStatus: object}>}
 */
async function obterEstatisticasPendencias(empresaId, dataInicio, dataFim) {
  try {
    const pendencias = await prisma.agenda.findMany({
      where: {
        empresaId,
        origemExterna: true,
        data: { gte: dataInicio, lte: dataFim },
        valor: { gt: 0 },
      },
      select: { status: true, valor: true },
    });

    const totalPendentes = pendencias.length;
    const valorTotal = pendencias.reduce(
      (sum, p) => sum.plus(p.valor),
      new Prisma.Decimal(0),
    );

    const porStatus = {};
    pendencias.forEach((p) => {
      porStatus[p.status] = (porStatus[p.status] || 0) + 1;
    });

    return {
      totalPendentes,
      valorTotal: valorTotal.toNumber(),
      porStatus,
    };
  } catch (erro) {
    throw new AppError(`Erro ao obter estatísticas: ${erro.message}`, 500);
  }
}

/**
 * Lista empresas que possuem integração ativa configurada no backend.
 * @returns {Promise<{fontesAtivas: Array<object>, empresas: Array<object>}>
 */
async function listarEmpresasIntegradas() {
  try {
    const fontesAtivas = getFontesAtivas();

    if (!fontesAtivas.length) {
      return { fontesAtivas: [], empresas: [] };
    }

    const empresas = await prisma.empresa.findMany({
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });

    const empresasIntegradas = empresas
      .map((empresa) => {
        const nomeNormalizado = String(empresa.nome || "").toLowerCase();

        const fonte = fontesAtivas.find((item) =>
          item.matchers.some((matcher) => nomeNormalizado.includes(matcher)),
        );

        if (!fonte) {
          return null;
        }

        const syncDisponivel =
          fonte.id === "maisquiosque"
            ? isMaisQuiosqueConfigured()
            : fonte.syncDisponivel;

        return {
          id: empresa.id,
          nome: empresa.nome,
          integracao: fonte.id,
          integracaoLabel: fonte.nome,
          syncDisponivel,
        };
      })
      .filter(Boolean);

    return {
      fontesAtivas: fontesAtivas.map((fonte) => ({
        id: fonte.id,
        nome: fonte.nome,
        syncDisponivel: fonte.syncDisponivel,
      })),
      empresas: empresasIntegradas,
    };
  } catch (erro) {
    throw new AppError(
      `Erro ao listar empresas integradas: ${erro.message}`,
      500,
    );
  }
}

module.exports = {
  fetchAgarraMaisAPI,
  syncAgarraMais,
  syncMaisQuiosque,
  listarMaisQuiosqueFechamentos,
  salvarMaisQuiosqueFechamento,
  aprovarPendencia,
  rejeitarPendencia,
  listarPendencias,
  obterEstatisticasPendencias,
  listarEmpresasIntegradas,
};

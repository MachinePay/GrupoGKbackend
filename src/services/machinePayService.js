const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const movimentacaoService = require("./movimentacaoService");

const STATUS_CLIENTE = ["ATIVO", "SUSPENSO", "INATIVO"];
const COMPETENCIA_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const CAMPO_POR_TIPO_MAQUINA = {
  PROPRIA: "maquinasProprias",
  PLANO36: "maquinasPlano36",
  OFF: "maquinasOff",
  PARCERIA: "maquinasParceria",
};

/**
 * Converte Decimal/nullable em numero.
 * @param {import("@prisma/client").Prisma.Decimal | null | undefined} value
 * @returns {number | null}
 */
function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value.toString());
}

/**
 * Converte entrada numerica opcional (aceita "40,50").
 * @param {unknown} value
 * @param {number | null} fallback
 * @returns {number | null}
 */
function parseNumero(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const numero = Number(String(value).replace(",", "."));

  if (Number.isNaN(numero) || numero < 0) {
    throw new AppError(`Valor numerico invalido: ${value}`, 400);
  }

  return numero;
}

/**
 * Valida competencia no formato YYYY-MM.
 * @param {string} competencia
 * @returns {string}
 */
function validarCompetencia(competencia) {
  if (!competencia || !COMPETENCIA_REGEX.test(String(competencia))) {
    throw new AppError("Competencia invalida. Use o formato AAAA-MM.", 400);
  }

  return String(competencia);
}

/**
 * Calcula o valor mensal de um cliente (valor fixo tem prioridade).
 * @param {object} cliente
 * @returns {number}
 */
function calcularValorCliente(cliente) {
  // Cliente sem mensalidade fica no cadastro, mas nao gera cobranca.
  if (cliente.semMensalidade) {
    return 0;
  }

  const valorFixo = decimalToNumber(cliente.valorFixo);

  if (valorFixo !== null) {
    return valorFixo;
  }

  const proprias = Number(cliente.maquinasProprias || 0);
  const plano36 = Number(cliente.maquinasPlano36 || 0);
  const valor = decimalToNumber(cliente.valorMensalidade) || 0;
  const valor36 = decimalToNumber(cliente.valorMensalidade36) || 0;
  // Maquinas de parceria: sem cobranca por padrao, ou valor combinado por maquina.
  const parceria = Number(cliente.maquinasParceria || 0);
  const valorParceria = decimalToNumber(cliente.valorMensalidadeParceria) || 0;

  return (
    Math.round((proprias * valor + plano36 * valor36 + parceria * valorParceria) * 100) / 100
  );
}

/**
 * Monta a data de vencimento da competencia respeitando o ultimo dia do mes.
 * Usa meio-dia UTC para evitar troca de dia por fuso.
 * @param {string} competencia
 * @param {number} diaVencimento
 * @returns {Date}
 */
function montarVencimento(competencia, diaVencimento) {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(Math.max(Number(diaVencimento) || 10, 1), ultimoDia);

  return new Date(Date.UTC(ano, mes - 1, dia, 12));
}

/**
 * Data de hoje (meio-dia UTC) para comparar com vencimentos.
 * @returns {Date}
 */
function hojeUtc() {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12),
  );
}

/**
 * Normaliza cliente para resposta da API.
 * @param {object} cliente
 * @returns {object}
 */
function normalizeCliente(cliente) {
  const { cobrancas, ajustesMaquinas, ...dados } = cliente;
  return {
    ...dados,
    valorMensalidade: decimalToNumber(cliente.valorMensalidade),
    valorMensalidade36: decimalToNumber(cliente.valorMensalidade36),
    valorMensalidadeParceria: decimalToNumber(cliente.valorMensalidadeParceria),
    valorFixo: decimalToNumber(cliente.valorFixo),
    totalMaquinas:
      Number(cliente.maquinasProprias || 0) +
      Number(cliente.maquinasPlano36 || 0) +
      Number(cliente.maquinasParceria || 0),
    valorCalculado: calcularValorCliente(cliente),
  };
}

/**
 * Normaliza cobranca e calcula a situacao (ATRASADO e derivado do vencimento).
 * @param {object} cobranca
 * @returns {object}
 */
function normalizeCobranca(cobranca) {
  let situacao = cobranca.status;

  if (cobranca.status === "PENDENTE" && cobranca.vencimento < hojeUtc()) {
    situacao = "ATRASADO";
  }

  return {
    ...cobranca,
    valorMensalidade: decimalToNumber(cobranca.valorMensalidade),
    valorMensalidade36: decimalToNumber(cobranca.valorMensalidade36),
    valorMensalidadeParceria: decimalToNumber(cobranca.valorMensalidadeParceria),
    valor: decimalToNumber(cobranca.valor),
    valorPago: decimalToNumber(cobranca.valorPago),
    situacao,
    cliente: cobranca.cliente ? normalizeCliente(cobranca.cliente) : undefined,
  };
}

/**
 * Converte payload de cliente para dados do Prisma.
 * @param {object} payload
 * @param {boolean} parcial
 * @returns {object}
 */
function mapClientePayload(payload, parcial = false) {
  const data = {};

  if (!parcial || payload.nome !== undefined) {
    const nome = String(payload.nome || "").trim();
    if (!nome) {
      throw new AppError("Nome do cliente e obrigatorio.", 400);
    }
    data.nome = nome;
  }

  for (const campo of ["documento", "telefone", "email", "observacoes"]) {
    if (payload[campo] !== undefined) {
      data[campo] = payload[campo] ? String(payload[campo]).trim() : null;
    }
  }

  if (payload.diaVencimento !== undefined) {
    const dia = Number(payload.diaVencimento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      throw new AppError("Dia de vencimento deve estar entre 1 e 31.", 400);
    }
    data.diaVencimento = dia;
  }

  for (const campo of ["maquinasProprias", "maquinasPlano36", "maquinasOff", "maquinasParceria"]) {
    if (payload[campo] !== undefined) {
      data[campo] = Math.trunc(parseNumero(payload[campo], 0));
    }
  }

  for (const campo of ["valorMensalidade", "valorMensalidade36", "valorMensalidadeParceria"]) {
    if (payload[campo] !== undefined) {
      data[campo] = parseNumero(payload[campo], 0);
    }
  }

  if (payload.valorFixo !== undefined) {
    data.valorFixo = parseNumero(payload.valorFixo, null);
  }

  if (payload.semMensalidade !== undefined) {
    data.semMensalidade = Boolean(payload.semMensalidade);
  }

  if (payload.agrupadoComId !== undefined) {
    const alvo = Number(payload.agrupadoComId);
    data.agrupadoComId = payload.agrupadoComId && Number.isInteger(alvo) && alvo > 0 ? alvo : null;
  }

  if (payload.status !== undefined) {
    if (!STATUS_CLIENTE.includes(payload.status)) {
      throw new AppError("Status de cliente invalido.", 400);
    }
    data.status = payload.status;
  }

  return data;
}

/**
 * Diferenca em dias inteiros entre duas datas.
 * @param {Date} inicio
 * @param {Date} fim
 * @returns {number}
 */
function diasEntre(inicio, fim) {
  return Math.max(0, Math.floor((fim - inicio) / 86400000));
}

/**
 * Calcula a situacao financeira do cliente a partir das cobrancas.
 * @param {Array<object>} cobrancas
 * @returns {object}
 */
function calcularFinanceiroCliente(cobrancas = []) {
  const hoje = hojeUtc();
  let ultimoPagamento = null;
  let valorEmAberto = 0;
  let valorAtrasado = 0;
  let cobrancasAtrasadas = 0;
  let vencimentoMaisAntigo = null;

  for (const cobranca of cobrancas) {
    if (cobranca.status === "PAGO" && cobranca.pagoEm) {
      if (!ultimoPagamento || cobranca.pagoEm > ultimoPagamento) {
        ultimoPagamento = cobranca.pagoEm;
      }
    }

    if (cobranca.status === "PENDENTE") {
      const valor = decimalToNumber(cobranca.valor) || 0;
      valorEmAberto += valor;

      if (cobranca.vencimento < hoje) {
        valorAtrasado += valor;
        cobrancasAtrasadas += 1;
        if (
          !vencimentoMaisAntigo ||
          cobranca.vencimento < vencimentoMaisAntigo
        ) {
          vencimentoMaisAntigo = cobranca.vencimento;
        }
      }
    }
  }

  return {
    ultimoPagamento,
    diasDesdeUltimoPagamento: ultimoPagamento
      ? diasEntre(ultimoPagamento, hoje)
      : null,
    diasEmAtraso: vencimentoMaisAntigo
      ? diasEntre(vencimentoMaisAntigo, hoje)
      : 0,
    valorEmAberto: Math.round(valorEmAberto * 100) / 100,
    valorAtrasado: Math.round(valorAtrasado * 100) / 100,
    cobrancasAtrasadas,
  };
}

/**
 * Lista clientes Machine Pay com a situacao financeira de cada um.
 * @returns {Promise<Array<object>>}
 */
async function listClientes() {
  const clientes = await prisma.machinePayCliente.findMany({
    orderBy: { nome: "asc" },
    include: {
      cobrancas: {
        where: { status: { in: ["PAGO", "PENDENTE"] } },
        select: { status: true, valor: true, vencimento: true, pagoEm: true },
      },
    },
  });

  return clientes.map((cliente) => ({
    ...normalizeCliente(cliente),
    ...calcularFinanceiroCliente(cliente.cobrancas),
  }));
}

/**
 * Valida "cobrar junto com": um nivel so (o responsavel nao pode estar
 * agrupado com outro, e quem ja e responsavel nao pode ser agrupado).
 * @param {number|null} clienteId Cliente sendo salvo (null no cadastro novo).
 * @param {number|null} responsavelId
 */
async function validarAgrupamento(clienteId, responsavelId) {
  if (!responsavelId) {
    return;
  }
  if (clienteId && responsavelId === clienteId) {
    throw new AppError("O cliente nao pode ser cobrado junto com ele mesmo.", 400);
  }

  const responsavel = await prisma.machinePayCliente.findUnique({
    where: { id: responsavelId },
    select: { nome: true, agrupadoComId: true },
  });
  if (!responsavel) {
    throw new AppError("Cliente responsavel pela cobranca nao encontrado.", 404);
  }
  if (responsavel.agrupadoComId) {
    throw new AppError(
      `${responsavel.nome} ja e cobrado junto com outro cliente. Escolha o responsavel principal.`,
      400,
    );
  }

  if (clienteId) {
    const dependentes = await prisma.machinePayCliente.count({
      where: { agrupadoComId: clienteId },
    });
    if (dependentes) {
      throw new AppError(
        "Este cliente ja e responsavel por outras cobrancas e nao pode ser agrupado com outro.",
        400,
      );
    }
  }
}

/**
 * Cria cliente.
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function createCliente(payload) {
  const data = mapClientePayload(payload);
  await validarAgrupamento(null, data.agrupadoComId);
  const cliente = await prisma.machinePayCliente.create({ data });

  return normalizeCliente(cliente);
}

/**
 * Atualiza cliente.
 * @param {number|string} id
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function updateCliente(id, payload, user) {
  const atual = await getClienteOrFail(id);
  const data = mapClientePayload(payload, true);
  if (data.agrupadoComId !== undefined) {
    await validarAgrupamento(atual.id, data.agrupadoComId);
  }
  const ajustes = Object.entries(CAMPO_POR_TIPO_MAQUINA)
    .filter(
      ([, campo]) => data[campo] !== undefined && data[campo] !== atual[campo],
    )
    .map(([tipo, campo]) => ({
      clienteId: atual.id,
      tipo,
      quantidade: data[campo] - atual[campo],
      motivo: "Edicao do cadastro",
      usuario: user?.email || null,
    }));

  const [cliente] = await prisma.$transaction([
    prisma.machinePayCliente.update({ where: { id: atual.id }, data }),
    prisma.machinePayAjusteMaquina.createMany({ data: ajustes }),
  ]);

  return normalizeCliente(cliente);
}

/**
 * Adiciona ou remove maquinas do cliente, registrando no historico.
 * Com aplicarNaCompetencia, recalcula a cobranca pendente daquele mes.
 * @param {number|string} id
 * @param {{ tipo: string, quantidade: number, motivo?: string, aplicarNaCompetencia?: string }} payload
 * @param {object} user
 * @returns {Promise<object>}
 */
async function ajustarMaquinas(id, payload = {}, user) {
  const atual = await getClienteOrFail(id);
  const campo = CAMPO_POR_TIPO_MAQUINA[payload.tipo];
  const quantidade = Math.trunc(Number(payload.quantidade));

  if (!campo) {
    throw new AppError("Tipo de maquina invalido.", 400);
  }

  if (!quantidade) {
    throw new AppError("Informe a quantidade a adicionar ou remover.", 400);
  }

  const novoTotal = atual[campo] + quantidade;
  if (novoTotal < 0) {
    throw new AppError(
      `O cliente possui apenas ${atual[campo]} maquina(s) desse tipo.`,
      400,
    );
  }

  const cliente = await prisma.$transaction(async (tx) => {
    const atualizado = await tx.machinePayCliente.update({
      where: { id: atual.id },
      data: { [campo]: novoTotal },
    });

    await tx.machinePayAjusteMaquina.create({
      data: {
        clienteId: atual.id,
        tipo: payload.tipo,
        quantidade,
        motivo: payload.motivo ? String(payload.motivo).trim() : null,
        usuario: user?.email || null,
      },
    });

    if (payload.aplicarNaCompetencia && payload.tipo !== "OFF") {
      const competencia = validarCompetencia(payload.aplicarNaCompetencia);
      let cobranca = await tx.machinePayCobranca.findUnique({
        where: {
          clienteId_competencia: { clienteId: atual.id, competencia },
        },
      });
      // Cliente cobrado junto com o responsavel: a cobranca e a dele.
      if (!cobranca && atual.agrupadoComId) {
        const doResponsavel = await tx.machinePayCobranca.findUnique({
          where: {
            clienteId_competencia: { clienteId: atual.agrupadoComId, competencia },
          },
        });
        if (doResponsavel?.itens?.some?.((item) => item.clienteId === atual.id)) {
          cobranca = doResponsavel;
        }
      }

      if (cobranca && cobranca.status === "PENDENTE") {
        const idsItens = Array.isArray(cobranca.itens)
          ? cobranca.itens.map((item) => item.clienteId)
          : [cobranca.clienteId];
        const membros = await tx.machinePayCliente.findMany({
          where: { id: { in: idsItens } },
        });
        const titular = membros.find((m) => m.id === cobranca.clienteId) || atualizado;
        const dados = dadosCobrancaGrupo(
          titular,
          [titular, ...membros.filter((m) => m.id !== titular.id)],
        );
        await tx.machinePayCobranca.update({ where: { id: cobranca.id }, data: dados });
      }
    }

    return atualizado;
  });

  return normalizeCliente(cliente);
}

/**
 * Remove cliente e suas cobrancas.
 * @param {number|string} id
 */
async function deleteCliente(id) {
  await getClienteOrFail(id);

  const comLancamento = await prisma.machinePayCobranca.count({
    where: { clienteId: Number(id), movimentacaoId: { not: null } },
  });

  if (comLancamento) {
    throw new AppError(
      "Cliente possui pagamentos lancados no financeiro. Estorne-os ou marque o cliente como inativo.",
      409,
    );
  }

  await prisma.machinePayCliente.delete({ where: { id: Number(id) } });
}

/**
 * Busca cliente ou dispara 404.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
async function getClienteOrFail(id) {
  const cliente = await prisma.machinePayCliente.findUnique({
    where: { id: Number(id) },
  });

  if (!cliente) {
    throw new AppError("Cliente Machine Pay nao encontrado.", 404);
  }

  return cliente;
}

/**
 * Historico de cobrancas de um cliente.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
async function getHistoricoCliente(id) {
  const cliente = await getClienteOrFail(id);
  const [cobrancas, ajustes, maquinas] = await Promise.all([
    prisma.machinePayCobranca.findMany({
      where: { clienteId: Number(id) },
      orderBy: { competencia: "desc" },
    }),
    prisma.machinePayAjusteMaquina.findMany({
      where: { clienteId: Number(id) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.machinePayMaquina.findMany({
      where: { clienteId: Number(id) },
      orderBy: [{ ligada: "desc" }, { inativa: "desc" }, { nome: "asc" }],
    }),
  ]);

  return {
    cliente: {
      ...normalizeCliente(cliente),
      ...calcularFinanceiroCliente(cobrancas),
    },
    cobrancas: cobrancas.map(normalizeCobranca),
    ajustes,
    maquinas,
  };
}

/**
 * Importa clientes em lote (atualiza quando o nome ja existe).
 * @param {Array<object>} itens
 * @returns {Promise<{ criados: number, atualizados: number }>}
 */
async function importarClientes(itens) {
  if (!Array.isArray(itens) || !itens.length) {
    throw new AppError("Nenhum cliente para importar.", 400);
  }

  const existentes = await prisma.machinePayCliente.findMany({
    select: { id: true, nome: true },
  });
  const porNome = new Map(
    existentes.map((item) => [item.nome.trim().toLowerCase(), item.id]),
  );

  let criados = 0;
  let atualizados = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of itens) {
      const data = mapClientePayload(item);
      const idExistente = porNome.get(data.nome.toLowerCase());

      if (idExistente) {
        await tx.machinePayCliente.update({
          where: { id: idExistente },
          data,
        });
        atualizados += 1;
      } else {
        const criado = await tx.machinePayCliente.create({ data });
        porNome.set(data.nome.toLowerCase(), criado.id);
        criados += 1;
      }
    }
  });

  return { criados, atualizados };
}

/**
 * Resume uma lista de cobrancas normalizadas.
 * @param {Array<object>} cobrancas
 * @returns {object}
 */
function resumirCobrancas(cobrancas) {
  const resumo = {
    quantidade: 0,
    previsto: 0,
    recebido: 0,
    emAberto: 0,
    atrasado: 0,
    qtdPagas: 0,
    qtdPendentes: 0,
    qtdAtrasadas: 0,
    maquinas: 0,
  };

  for (const cobranca of cobrancas) {
    if (cobranca.status === "CANCELADO") {
      continue;
    }

    resumo.quantidade += 1;
    resumo.previsto += cobranca.valor;
    resumo.maquinas +=
      cobranca.maquinasProprias + cobranca.maquinasPlano36 + (cobranca.maquinasParceria || 0);

    if (cobranca.status === "PAGO") {
      resumo.recebido += cobranca.valorPago ?? cobranca.valor;
      resumo.qtdPagas += 1;
    } else {
      resumo.emAberto += cobranca.valor;
      resumo.qtdPendentes += 1;
      if (cobranca.situacao === "ATRASADO") {
        resumo.atrasado += cobranca.valor;
        resumo.qtdAtrasadas += 1;
      }
    }
  }

  for (const chave of ["previsto", "recebido", "emAberto", "atrasado"]) {
    resumo[chave] = Math.round(resumo[chave] * 100) / 100;
  }

  return resumo;
}

/**
 * Lista cobrancas de uma competencia com resumo.
 * @param {string} competencia
 * @returns {Promise<object>}
 */
async function getCompetencia(competencia) {
  const comp = validarCompetencia(competencia);

  const [cobrancas, clientesAtivos] = await Promise.all([
    prisma.machinePayCobranca.findMany({
      where: { competencia: comp },
      include: { cliente: true },
      orderBy: [{ vencimento: "asc" }, { cliente: { nome: "asc" } }],
    }),
    prisma.machinePayCliente.findMany({
      where: { status: "ATIVO" },
      select: { id: true },
    }),
  ]);

  const normalizadas = cobrancas.map(normalizeCobranca);
  const comCobranca = new Set(normalizadas.map((item) => item.clienteId));
  // Clientes cobrados dentro da cobranca de um responsavel.
  for (const cobranca of normalizadas) {
    for (const item of Array.isArray(cobranca.itens) ? cobranca.itens : []) {
      comCobranca.add(item.clienteId);
    }
  }

  return {
    competencia: comp,
    cobrancas: normalizadas,
    resumo: resumirCobrancas(normalizadas),
    clientesSemCobranca: clientesAtivos.filter(
      (item) => !comCobranca.has(item.id),
    ).length,
  };
}

/**
 * Le a configuracao global do Machine Pay (padrao: cobranca desativada).
 * Tolera a tabela ainda nao migrada para nao derrubar a tela.
 * @returns {Promise<{ cobrancaAtiva: boolean, updatedBy: string|null, updatedAt: Date|null }>}
 */
async function getConfig() {
  try {
    const config = await prisma.machinePayConfig.findUnique({ where: { id: 1 } });
    return {
      cobrancaAtiva: Boolean(config?.cobrancaAtiva),
      updatedBy: config?.updatedBy ?? null,
      updatedAt: config?.updatedAt ?? null,
    };
  } catch (error) {
    if (error?.code === "P2021") {
      return { cobrancaAtiva: false, updatedBy: null, updatedAt: null };
    }
    throw error;
  }
}

/**
 * Liga ou desliga a cobranca (quando desligada, o modulo e apenas cadastro).
 * @param {{ cobrancaAtiva: boolean }} payload
 * @param {object} user
 * @returns {Promise<object>}
 */
async function updateConfig(payload = {}, user) {
  if (typeof payload.cobrancaAtiva !== "boolean") {
    throw new AppError("Informe cobrancaAtiva como verdadeiro ou falso.", 400);
  }

  const data = {
    cobrancaAtiva: payload.cobrancaAtiva,
    updatedBy: user?.email || null,
  };

  await prisma.machinePayConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  return getConfig();
}

/**
 * Monta os dados da cobranca do responsavel somando os clientes do grupo.
 * Com um cliente so, e a cobranca normal (sem itens).
 * @param {object} responsavel
 * @param {object[]} membros Clientes cobrados nesta cobranca (inclui o responsavel).
 * @returns {object}
 */
function dadosCobrancaGrupo(responsavel, membros) {
  const soma = (campo) => membros.reduce((a, m) => a + Number(m[campo] || 0), 0);
  const valor = Math.round(membros.reduce((a, m) => a + calcularValorCliente(m), 0) * 100) / 100;

  return {
    maquinasProprias: soma("maquinasProprias"),
    maquinasPlano36: soma("maquinasPlano36"),
    maquinasParceria: soma("maquinasParceria"),
    valorMensalidade: responsavel.valorMensalidade,
    valorMensalidade36: responsavel.valorMensalidade36,
    valorMensalidadeParceria: responsavel.valorMensalidadeParceria,
    valor,
    itens:
      membros.length > 1
        ? membros.map((m) => ({
            clienteId: m.id,
            nome: m.nome,
            maquinas:
              Number(m.maquinasProprias || 0) +
              Number(m.maquinasPlano36 || 0) +
              Number(m.maquinasParceria || 0),
            valor: calcularValorCliente(m),
          }))
        : Prisma.DbNull,
  };
}

/**
 * Separa os clientes ativos em grupos de cobranca. O agrupamento so vale
 * quando o responsavel esta ativo; senao cada um e cobrado sozinho.
 * @param {object[]} ativos
 * @returns {Map<number, object[]>} responsavelId -> membros
 */
function agruparClientes(ativos) {
  const porId = new Map(ativos.map((c) => [c.id, c]));
  const grupos = new Map();
  for (const cliente of ativos) {
    const responsavelId =
      cliente.agrupadoComId && porId.has(cliente.agrupadoComId) ? cliente.agrupadoComId : cliente.id;
    if (!grupos.has(responsavelId)) grupos.set(responsavelId, []);
    grupos.get(responsavelId).push(cliente);
  }
  // Responsavel primeiro na lista de itens.
  for (const [id, membros] of grupos) {
    membros.sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : a.nome.localeCompare(b.nome)));
  }
  return grupos;
}

/**
 * Gera cobrancas da competencia para clientes ativos que ainda nao tem.
 * @param {string} competencia
 * @returns {Promise<{ geradas: number }>}
 */
async function gerarCobrancas(competencia) {
  const comp = validarCompetencia(competencia);
  const config = await getConfig();

  if (!config.cobrancaAtiva) {
    throw new AppError(
      "A cobranca do Machine Pay esta desativada. Ative-a para gerar cobrancas.",
      409,
    );
  }

  const ativos = await prisma.machinePayCliente.findMany({
    where: { status: "ATIVO" },
    include: { cobrancas: { where: { competencia: comp }, select: { id: true } } },
  });

  const data = [];
  for (const [responsavelId, grupo] of agruparClientes(ativos)) {
    const responsavel = grupo.find((c) => c.id === responsavelId);
    // Quem ja tem cobranca no mes (gerada antes do agrupamento) fica de fora.
    const membros = grupo.filter((c) => !c.cobrancas.length);
    if (!membros.length) continue;

    // Responsavel ja cobrado no mes: os novos do grupo saem sozinhos,
    // para ninguem ficar sem cobranca.
    const lotes = responsavel.cobrancas.length
      ? membros.map((m) => [m, [m]])
      : [[responsavel, membros]];

    for (const [titular, itens] of lotes) {
      data.push({
        clienteId: titular.id,
        competencia: comp,
        vencimento: montarVencimento(comp, titular.diaVencimento),
        ...dadosCobrancaGrupo(titular, itens),
      });
    }
  }

  // Sem valor (sem mensalidade, sem maquinas) nao gera cobranca.
  const aGerar = data.filter((item) => item.valor > 0);

  const resultado = await prisma.machinePayCobranca.createMany({
    data: aGerar,
    skipDuplicates: true,
  });

  return { geradas: resultado.count };
}

/**
 * Busca cobranca ou dispara 404.
 * @param {number|string} id
 * @returns {Promise<object>}
 */
async function getCobrancaOrFail(id) {
  const cobranca = await prisma.machinePayCobranca.findUnique({
    where: { id: Number(id) },
  });

  if (!cobranca) {
    throw new AppError("Cobranca nao encontrada.", 404);
  }

  return cobranca;
}

/**
 * Ajusta valor, vencimento ou observacoes de uma cobranca.
 * @param {number|string} id
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function updateCobranca(id, payload) {
  await getCobrancaOrFail(id);
  const data = {};

  if (payload.valor !== undefined) {
    data.valor = parseNumero(payload.valor, 0);
  }

  if (payload.vencimento) {
    const vencimento = new Date(`${String(payload.vencimento).slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(vencimento.getTime())) {
      throw new AppError("Data de vencimento invalida.", 400);
    }
    data.vencimento = vencimento;
  }

  if (payload.observacoes !== undefined) {
    data.observacoes = payload.observacoes || null;
  }

  const cobranca = await prisma.machinePayCobranca.update({
    where: { id: Number(id) },
    data,
    include: { cliente: true },
  });

  return normalizeCobranca(cobranca);
}

/**
 * Busca a empresa Machine Pay usada nos lancamentos financeiros.
 * @param {object} client
 * @returns {Promise<object>}
 */
async function getEmpresaMachinePay(client = prisma) {
  const empresa = await client.empresa.findFirst({
    where: { nome: { equals: "MachinePay", mode: "insensitive" } },
  });

  if (!empresa) {
    throw new AppError("Empresa MachinePay nao cadastrada.", 404);
  }

  return empresa;
}

/**
 * Remove o lancamento financeiro vinculado (estornando o saldo).
 * @param {object} tx
 * @param {object} cobranca
 */
async function removerLancamentoVinculado(tx, cobranca) {
  if (!cobranca.movimentacaoId) {
    return;
  }

  const existe = await tx.movimentacao.findUnique({
    where: { id: cobranca.movimentacaoId },
    select: { id: true },
  });

  if (existe) {
    await movimentacaoService.deleteMovimentacao(cobranca.movimentacaoId, {
      tx,
    });
  }
}

/**
 * Registra pagamento de uma cobranca. Com contaDestinoId, lanca a entrada
 * no financeiro (MachinePay) e atualiza o saldo da conta.
 * @param {number|string} id
 * @param {object} payload
 * @param {object} user
 * @returns {Promise<object>}
 */
async function pagarCobranca(id, payload = {}, user) {
  const atual = await prisma.machinePayCobranca.findUnique({
    where: { id: Number(id) },
    include: { cliente: true },
  });

  if (!atual) {
    throw new AppError("Cobranca nao encontrada.", 404);
  }

  const pagoEm = payload.pagoEm
    ? new Date(`${String(payload.pagoEm).slice(0, 10)}T12:00:00Z`)
    : hojeUtc();

  if (Number.isNaN(pagoEm.getTime())) {
    throw new AppError("Data de pagamento invalida.", 400);
  }

  const valorPago = parseNumero(payload.valorPago, decimalToNumber(atual.valor));

  if (!valorPago) {
    throw new AppError("Valor pago deve ser maior que zero.", 400);
  }

  const cobranca = await prisma.$transaction(async (tx) => {
    await removerLancamentoVinculado(tx, atual);

    let movimentacaoId = null;

    if (payload.contaDestinoId) {
      const empresa = await getEmpresaMachinePay(tx);
      const movimentacao = await movimentacaoService.createMovimentacao(
        {
          empresaId: empresa.id,
          tipo: "ENTRADA",
          status: "REALIZADO",
          categoria: "SISTEMA",
          valor: valorPago,
          data: pagoEm.toISOString(),
          contaDestinoId: Number(payload.contaDestinoId),
          referencia: `Machine Pay ${atual.competencia} - ${atual.cliente.nome}`,
        },
        { tx, user },
      );
      movimentacaoId = movimentacao.id;
    }

    return tx.machinePayCobranca.update({
      where: { id: Number(id) },
      data: {
        status: "PAGO",
        pagoEm,
        valorPago,
        formaPagamento: payload.formaPagamento || null,
        movimentacaoId,
      },
      include: { cliente: true },
    });
  });

  return normalizeCobranca(cobranca);
}

/**
 * Altera status da cobranca sem pagamento (estornar ou cancelar),
 * removendo o lancamento financeiro vinculado.
 * @param {number|string} id
 * @param {"PENDENTE"|"CANCELADO"} status
 * @returns {Promise<object>}
 */
async function alterarStatusCobranca(id, status) {
  const atual = await getCobrancaOrFail(id);

  const cobranca = await prisma.$transaction(async (tx) => {
    await removerLancamentoVinculado(tx, atual);

    return tx.machinePayCobranca.update({
      where: { id: Number(id) },
      data: {
        status,
        pagoEm: null,
        valorPago: null,
        formaPagamento: null,
        movimentacaoId: null,
        // Desvincula o Pix SumUp: um checkout ja pago nao pode dar baixa de novo.
        sumupCheckoutId: null,
        sumupReferencia: null,
        pixCopiaCola: null,
        pixQrUrl: null,
        pixGeradoEm: null,
        pixValidoAte: null,
      },
      include: { cliente: true },
    });
  });

  return normalizeCobranca(cobranca);
}

/**
 * Remove uma cobranca.
 * @param {number|string} id
 */
async function deleteCobranca(id) {
  const atual = await getCobrancaOrFail(id);

  await prisma.$transaction(async (tx) => {
    await removerLancamentoVinculado(tx, atual);
    await tx.machinePayCobranca.delete({ where: { id: Number(id) } });
  });
}

/**
 * Filtro das cobrancas que o "Apagar cobrancas" alcanca.
 * @param {string} competencia "AAAA-MM" ou "TODAS".
 * @param {boolean} incluirPagas
 * @returns {object}
 */
function filtroApagar(competencia, incluirPagas) {
  const where = {};
  if (competencia !== "TODAS") {
    where.competencia = validarCompetencia(competencia);
  }
  if (!incluirPagas) {
    where.status = { not: "PAGO" };
  }
  return where;
}

/**
 * Resumo do que existe por competencia, para a tela de apagar cobrancas.
 * @returns {Promise<Array<{ competencia: string, total: number, pendentes: number, pagas: number, canceladas: number, valor: number }>>}
 */
async function previaApagarCobrancas() {
  const linhas = await prisma.machinePayCobranca.groupBy({
    by: ["competencia", "status"],
    _count: { _all: true },
    _sum: { valor: true },
  });

  const porCompetencia = new Map();
  for (const linha of linhas) {
    if (!porCompetencia.has(linha.competencia)) {
      porCompetencia.set(linha.competencia, {
        competencia: linha.competencia,
        total: 0,
        pendentes: 0,
        pagas: 0,
        canceladas: 0,
        valor: 0,
      });
    }
    const item = porCompetencia.get(linha.competencia);
    const qtd = linha._count._all;
    item.total += qtd;
    item.valor += decimalToNumber(linha._sum.valor) || 0;
    if (linha.status === "PAGO") item.pagas += qtd;
    else if (linha.status === "CANCELADO") item.canceladas += qtd;
    else item.pendentes += qtd;
  }

  return [...porCompetencia.values()]
    .map((item) => ({ ...item, valor: Math.round(item.valor * 100) / 100 }))
    .sort((a, b) => b.competencia.localeCompare(a.competencia));
}

/**
 * Apaga cobrancas em lote (de um mes ou todas). Pagas so com incluirPagas:
 * o lancamento no financeiro e removido e o saldo da conta ajustado.
 * @param {{ competencia: string, incluirPagas?: boolean, confirmacao: string }} payload
 * @param {{ antesDeApagar?: (cobrancas: object[]) => Promise<void> }} opcoes
 * @returns {Promise<{ apagadas: number, lancamentosRemovidos: number }>}
 */
async function apagarCobrancas(payload = {}, { antesDeApagar } = {}) {
  if (String(payload.confirmacao || "").trim().toUpperCase() !== "APAGAR") {
    throw new AppError('Digite APAGAR para confirmar.', 400);
  }

  const where = filtroApagar(String(payload.competencia || ""), Boolean(payload.incluirPagas));
  const cobrancas = await prisma.machinePayCobranca.findMany({
    where,
    select: { id: true, status: true, movimentacaoId: true, sumupCheckoutId: true },
  });

  if (!cobrancas.length) {
    return { apagadas: 0, lancamentosRemovidos: 0 };
  }

  if (antesDeApagar) {
    await antesDeApagar(cobrancas);
  }

  // Com lancamento no financeiro: uma por vez, estornando o saldo.
  const comLancamento = cobrancas.filter((c) => c.movimentacaoId);
  for (const cobranca of comLancamento) {
    await prisma.$transaction(async (tx) => {
      await removerLancamentoVinculado(tx, cobranca);
      await tx.machinePayCobranca.delete({ where: { id: cobranca.id } });
    });
  }

  const resto = await prisma.machinePayCobranca.deleteMany({
    where: { id: { in: cobrancas.filter((c) => !c.movimentacaoId).map((c) => c.id) } },
  });

  return {
    apagadas: comLancamento.length + resto.count,
    lancamentosRemovidos: comLancamento.length,
  };
}

/**
 * Evolucao previsto x recebido das ultimas competencias.
 * @param {number} meses
 * @returns {Promise<Array<object>>}
 */
async function getEvolucao(meses = 6) {
  const cobrancas = await prisma.machinePayCobranca.findMany({
    where: { status: { not: "CANCELADO" } },
    select: {
      competencia: true,
      status: true,
      valor: true,
      valorPago: true,
      vencimento: true,
      maquinasProprias: true,
      maquinasPlano36: true,
      maquinasParceria: true,
    },
  });

  const porCompetencia = new Map();
  for (const item of cobrancas.map(normalizeCobranca)) {
    if (!porCompetencia.has(item.competencia)) {
      porCompetencia.set(item.competencia, []);
    }
    porCompetencia.get(item.competencia).push(item);
  }

  return [...porCompetencia.keys()]
    .sort()
    .slice(-Math.max(1, Number(meses) || 6))
    .map((competencia) => ({
      competencia,
      ...resumirCobrancas(porCompetencia.get(competencia)),
    }));
}

module.exports = {
  getConfig,
  updateConfig,
  listClientes,
  createCliente,
  updateCliente,
  ajustarMaquinas,
  deleteCliente,
  getHistoricoCliente,
  importarClientes,
  getCompetencia,
  gerarCobrancas,
  updateCobranca,
  pagarCobranca,
  alterarStatusCobranca,
  deleteCobranca,
  previaApagarCobrancas,
  apagarCobrancas,
  getEvolucao,
};

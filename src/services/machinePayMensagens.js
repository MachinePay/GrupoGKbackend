// Mensagens de cobranca do Machine Pay e do CompactPay, por modelo editavel
// em Configuracoes. ESTE ARQUIVO TEM UMA COPIA IGUAL no frontend
// (src/lib/machinePayMensagens.js): o envio automatico e o botao copiar
// montam o mesmo texto. Altere os dois juntos.

const NOMES_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const MODELO_LEMBRETE_PADRAO =
  "Olá! Tudo bem? 😊\n\n" +
  "{marca} | Financeiro\n\n" +
  "Segue a sua mensalidade:\n\n" +
  "▪️ Equipamentos ativos: {equipamentos}\n" +
  "{valores}\n" +
  "▪️ Vencimento: dia {dia_vencimento}\n\n" +
  "{detalhe}\n\n" +
  "{pagamento}\n\n" +
  "Agradecemos pela parceria! Estamos à disposição para ajudar.\n\n" +
  "Equipe Financeira | {marca}";

const MODELO_ATRASO_PADRAO =
  "Olá! Tudo bem?\n\n" +
  "{marca} | Financeiro\n\n" +
  "Identificamos {situacao_atraso}\n\n" +
  "▪️ Equipamentos ativos: {equipamentos}\n" +
  "{valores}\n" +
  "▪️ Vencimento: dia {dia_vencimento}\n\n" +
  "{detalhe}\n\n" +
  "⚠️ Evite o bloqueio do cadastro e a suspensão dos serviços. Pedimos que regularize o pagamento para manter seus equipamentos conectados à {marca}.\n\n" +
  "{pagamento}\n\n" +
  "Se precisar de ajuda para regularizar, fale com a nossa equipe.\n\n" +
  "Equipe Financeira | {marca}";

// Variaveis que podem ser usadas nos modelos (aparecem na tela de edicao).
const VARIAVEIS = [
  { chave: "marca", descricao: "Nome do produto (ex.: MachinePay, CompactPay)" },
  { chave: "cliente", descricao: "Nome do cliente" },
  { chave: "equipamentos", descricao: "Quantidade de máquinas cobradas" },
  { chave: "valores", descricao: "Linhas de valor (com meses em aberto, mostra cada mês e o total)" },
  { chave: "valor_total", descricao: "Valor total da cobrança" },
  { chave: "dia_vencimento", descricao: "Dia do vencimento (ex.: 10)" },
  { chave: "vencimento", descricao: "Data do vencimento (ex.: 10/11/2026)" },
  { chave: "mes", descricao: "Mês da cobrança (ex.: novembro/2026)" },
  { chave: "dias_atraso", descricao: "Dias de atraso (ex.: 16 dias)" },
  { chave: "situacao_atraso", descricao: "Frase do atraso (1 mês ou vários meses somados)" },
  { chave: "meses_em_aberto", descricao: "Mensalidades em aberto (ex.: 2 mensalidades)" },
  { chave: "detalhe", descricao: "Lista de clientes da cobrança unificada (vazio se for um só)" },
  { chave: "pagamento", descricao: "Como pagar (Pix SumUp ou chave Pix)" },
  { chave: "chave_pix", descricao: "Chave Pix do produto" },
];

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function nomeCompetencia(competencia) {
  const [ano, mes] = String(competencia).split("-").map(Number);
  return `${NOMES_MESES[mes - 1]}/${ano}`;
}

/**
 * Dias desde o vencimento (gravado ao meio-dia UTC), pelo dia de hoje no Brasil.
 * @param {Date|string} vencimento
 * @returns {number}
 */
function diasDeAtraso(vencimento) {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12);
  return Math.max(0, Math.round((hoje - new Date(vencimento).getTime()) / 86400000));
}

/**
 * Meses anteriores somados na cobranca, agrupados por mes.
 * @param {object} cobranca
 * @returns {Array<{ competencia: string, valor: number, vencimento: string }>}
 */
function mesesSomados(cobranca) {
  const porMes = new Map();
  for (const item of Array.isArray(cobranca?.anteriores) ? cobranca.anteriores : []) {
    const atual = porMes.get(item.competencia) || { competencia: item.competencia, valor: 0, vencimento: item.vencimento };
    atual.valor += Number(item.valor || 0);
    if (new Date(item.vencimento) < new Date(atual.vencimento)) atual.vencimento = item.vencimento;
    porMes.set(item.competencia, atual);
  }
  return [...porMes.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

function linhasValor(cobranca) {
  const meses = mesesSomados(cobranca);
  if (!meses.length) {
    return `▪️ Valor total: ${formatarMoeda(cobranca.valor)}`;
  }
  const valorMes = Number(cobranca.valor) - Number(cobranca.valorAnterior || 0);
  return [
    ...meses.map((m) => `▪️ Em aberto de ${nomeCompetencia(m.competencia)}: ${formatarMoeda(m.valor)}`),
    `▪️ Mensalidade de ${nomeCompetencia(cobranca.competencia)}: ${formatarMoeda(valorMes)}`,
    `▪️ Valor total: ${formatarMoeda(cobranca.valor)}`,
  ].join("\n");
}

function detalharItens(cobranca) {
  const itens = Array.isArray(cobranca?.itens) ? cobranca.itens : [];
  if (itens.length < 2) return "";
  return (
    "Cobrança unificada:\n" +
    itens
      .map((i) => `   • ${i.nome}: ${i.maquinas} ${i.maquinas === 1 ? "equipamento" : "equipamentos"} · ${formatarMoeda(i.valor)}`)
      .join("\n")
  );
}

/**
 * Bloco de pagamento.
 * @param {{ tipo: "chave"|"sumup_proxima"|"sumup_junto", chavePix?: string, copiaCola?: string, validoAte?: string|Date }} pagamento
 * @returns {string}
 */
function blocoPagamento(pagamento = {}) {
  if (pagamento.tipo === "sumup_proxima") {
    const validade = pagamento.validoAte
      ? `\nPix válido até ${new Date(pagamento.validoAte).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`
      : "";
    return "💳 Pagamento via Pix\nO código Pix copia e cola vem na próxima mensagem. A baixa é automática, não precisa enviar comprovante. ✅" + validade;
  }
  if (pagamento.tipo === "sumup_junto") {
    return `💳 Pague com o Pix copia e cola abaixo. A baixa é automática, não precisa enviar comprovante:\n\n${pagamento.copiaCola || ""}`;
  }
  const chave = String(pagamento.chavePix || "").trim();
  const rotulo = /^\d{14}$/.test(chave) ? "Chave CNPJ" : "Chave Pix";
  return `💳 Pagamento via Pix\n${rotulo}:\n${chave}\n\nApós o pagamento, envie o comprovante por este WhatsApp para confirmarmos a baixa.`;
}

/**
 * Troca {variavel} pelos valores e limpa linhas em branco sobrando
 * (variaveis vazias, como {detalhe} numa cobranca de um cliente so).
 * @param {string} modelo
 * @param {Record<string, string|number>} valores
 * @returns {string}
 */
function preencherModelo(modelo, valores) {
  return String(modelo || "")
    .replace(/\{(\w+)\}/g, (inteiro, chave) => (chave in valores ? String(valores[chave] ?? "") : inteiro))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Monta a mensagem de uma cobranca: modelo de atraso quando venceu ou traz
 * meses em aberto somados; senao, o lembrete.
 * @param {object} cobranca Cobranca (com cliente).
 * @param {{ marca?: string, chavePix?: string, mensagemLembrete?: string|null, mensagemAtraso?: string|null }} config Configuracao do produto.
 * @param {{ tipo?: string, copiaCola?: string, validoAte?: string|Date }} pagamento
 * @returns {string}
 */
function montarMensagemCobranca(cobranca, config = {}, pagamento = {}) {
  const maquinas =
    Number(cobranca.maquinasProprias || 0) +
    Number(cobranca.maquinasPlano36 || 0) +
    Number(cobranca.maquinasParceria || 0);
  const somados = mesesSomados(cobranca);
  // Com meses somados, o atraso conta do vencimento mais antigo em aberto.
  const dias = diasDeAtraso(somados.length ? somados[0].vencimento : cobranca.vencimento);
  const qtdMeses = somados.length;
  const emAtraso = dias > 0;
  const textoDias = `${dias} ${dias === 1 ? "dia" : "dias"}`;
  const textoMeses = `${qtdMeses + (emAtraso && !qtdMeses ? 1 : 0)} ${qtdMeses + (emAtraso && !qtdMeses ? 1 : 0) === 1 ? "mensalidade" : "mensalidades"}`;

  const valores = {
    marca: config.marca || "MachinePay",
    cliente: cobranca.cliente?.nome || "",
    equipamentos: maquinas,
    valores: linhasValor(cobranca),
    valor_total: formatarMoeda(cobranca.valor),
    dia_vencimento: new Date(cobranca.vencimento).getUTCDate(),
    vencimento: new Date(cobranca.vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" }),
    mes: nomeCompetencia(cobranca.competencia),
    dias_atraso: textoDias,
    meses_em_aberto: textoMeses,
    situacao_atraso: qtdMeses
      ? `${qtdMeses} ${qtdMeses === 1 ? "mensalidade" : "mensalidades"} em aberto, com ${textoDias} de atraso. Somamos tudo nesta cobrança:`
      : `que a mensalidade abaixo permanece em aberto, com ${textoDias} de atraso:`,
    detalhe: detalharItens(cobranca),
    pagamento: blocoPagamento({ tipo: "chave", chavePix: config.chavePix, ...pagamento }),
    chave_pix: config.chavePix || "",
  };

  const modelo = emAtraso
    ? config.mensagemAtraso || MODELO_ATRASO_PADRAO
    : config.mensagemLembrete || MODELO_LEMBRETE_PADRAO;
  return preencherModelo(modelo, valores);
}

/**
 * Mensagem de atraso para o cliente (aba Inadimplencia): tudo que ele deve.
 * @param {object} cliente Cliente com a situacao financeira (valorAtrasado, diasEmAtraso, cobrancasAtrasadas).
 * @param {object} config Configuracao do produto.
 * @returns {string}
 */
function montarMensagemCliente(cliente, config = {}) {
  const dias = Number(cliente.diasEmAtraso || 0);
  const meses = Number(cliente.cobrancasAtrasadas || 0);
  const textoDias = `${dias} ${dias === 1 ? "dia" : "dias"}`;
  const valores = {
    marca: config.marca || "MachinePay",
    cliente: cliente.nome || "",
    equipamentos: cliente.totalMaquinas ?? 0,
    valores: `▪️ Valor total: ${formatarMoeda(cliente.valorAtrasado)}`,
    valor_total: formatarMoeda(cliente.valorAtrasado),
    dia_vencimento: cliente.diaVencimento ?? "",
    vencimento: "",
    mes: "",
    dias_atraso: textoDias,
    meses_em_aberto: `${meses} ${meses === 1 ? "mensalidade" : "mensalidades"}`,
    situacao_atraso:
      meses > 1
        ? `${meses} mensalidades em aberto, com ${textoDias} de atraso:`
        : `que a mensalidade abaixo permanece em aberto, com ${textoDias} de atraso:`,
    detalhe: "",
    pagamento: blocoPagamento({ tipo: "chave", chavePix: config.chavePix }),
    chave_pix: config.chavePix || "",
  };
  return preencherModelo(config.mensagemAtraso || MODELO_ATRASO_PADRAO, valores);
}

module.exports = {
  MODELO_LEMBRETE_PADRAO,
  MODELO_ATRASO_PADRAO,
  VARIAVEIS,
  preencherModelo,
  montarMensagemCobranca,
  montarMensagemCliente,
  mesesSomados,
  nomeCompetencia,
};

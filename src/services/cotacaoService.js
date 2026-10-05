const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");

/** Moedas suportadas e cotacao padrao (em reais) usada quando ainda nao ha registro. */
const MOEDAS_PADRAO = {
  USD: 4.99,
  EUR: 5.86,
};

/**
 * Lista as cotacoes cadastradas, completando com o valor padrao as moedas sem registro.
 * @returns {Promise<{ moeda: string, valorEmReais: number, updatedAt: Date | null }[]>}
 */
async function getCotacoes() {
  const registros = await prisma.cotacaoMoeda.findMany();
  const porMoeda = new Map(registros.map((r) => [r.moeda, r]));

  return Object.entries(MOEDAS_PADRAO).map(([moeda, padrao]) => {
    const registro = porMoeda.get(moeda);
    return {
      moeda,
      valorEmReais: registro ? Number(registro.valorEmReais.toString()) : padrao,
      updatedAt: registro?.updatedAt ?? null,
    };
  });
}

/**
 * Retorna a cotacao de uma moeda em reais.
 * @param {"USD" | "EUR"} moeda
 * @returns {Promise<number>}
 */
async function getCotacao(moeda) {
  const cotacoes = await getCotacoes();
  return cotacoes.find((c) => c.moeda === moeda)?.valorEmReais ?? 1;
}

/**
 * Atualiza as cotacoes informadas.
 * @param {Record<string, number | string>} payload Ex.: { USD: 4.99, EUR: 5.86 }
 * @returns {Promise<object[]>}
 */
async function updateCotacoes(payload) {
  const entradas = Object.entries(payload || {}).filter(([moeda]) =>
    Object.prototype.hasOwnProperty.call(MOEDAS_PADRAO, moeda),
  );

  if (entradas.length === 0) {
    throw new AppError("Informe ao menos uma cotacao (USD ou EUR).", 400);
  }

  const valores = entradas.map(([moeda, valor]) => {
    const numero = Number(String(valor).replace(",", "."));
    if (!Number.isFinite(numero) || numero <= 0) {
      throw new AppError(`Cotacao invalida para ${moeda}.`, 400);
    }
    return [moeda, numero];
  });

  await prisma.$transaction(
    valores.map(([moeda, valorEmReais]) =>
      prisma.cotacaoMoeda.upsert({
        where: { moeda },
        create: { moeda, valorEmReais },
        update: { valorEmReais },
      }),
    ),
  );

  return getCotacoes();
}

module.exports = {
  getCotacoes,
  getCotacao,
  updateCotacoes,
};

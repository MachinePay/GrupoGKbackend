// Contas SumUp do grupo (duBob, CompactPay, Machine Pay...). Guarda a API key
// de cada conta para listar e esquecer as maquininhas pareadas na Cloud API
// dela: uma maquininha pareada numa conta reconecta sozinha e nao mostra o
// codigo de pareamento ate ser apagada la.

const prisma = require("../config/prisma");
const AppError = require("../middlewares/appError");
const { chamarSumup, lerConta, mascararChave } = require("./sumupService");

/**
 * Esconde a chave antes de devolver para a tela.
 * @param {object} conta
 * @returns {object}
 */
function paraTela(conta) {
  const { apiKey, ...resto } = conta;
  return { ...resto, apiKeyMascarada: mascararChave(apiKey) };
}

/**
 * Busca a conta com a chave (uso interno).
 * @param {number|string} id
 * @returns {Promise<object>}
 */
async function buscarConta(id) {
  const conta = await prisma.sumupConta.findUnique({ where: { id: Number(id) } });
  if (!conta) {
    throw new AppError("Conta SumUp nao encontrada.", 404);
  }
  return conta;
}

/**
 * Valida a chave na SumUp e descobre o merchant code e o nome da conta.
 * @param {string} apiKey
 * @returns {Promise<{merchantCode: string, nomeConta: string|null}>}
 */
async function validarChave(apiKey) {
  const conta = await lerConta(apiKey);
  if (!conta.merchantCode) {
    throw new AppError("A SumUp nao informou o codigo do estabelecimento (merchant code).", 502);
  }
  return { merchantCode: conta.merchantCode, nomeConta: conta.nome };
}

async function listar() {
  try {
    const contas = await prisma.sumupConta.findMany({ orderBy: { nome: "asc" } });
    return contas.map(paraTela);
  } catch (error) {
    if (error?.code === "P2021") {
      throw new AppError("Rode a migracao 019_add_sumup_contas no banco.", 500);
    }
    throw error;
  }
}

/**
 * @param {{nome?: string, apiKey?: string}} dados
 * @param {object} user
 */
async function criar(dados, user) {
  const nome = String(dados?.nome || "").trim();
  const apiKey = String(dados?.apiKey || "").trim();
  if (!nome) {
    throw new AppError("Informe um nome para a conta.", 400);
  }
  if (!apiKey) {
    throw new AppError("Informe a API key da conta SumUp.", 400);
  }

  const { merchantCode, nomeConta } = await validarChave(apiKey);
  const conta = await prisma.sumupConta.create({
    data: { nome, apiKey, merchantCode, nomeConta, updatedBy: user?.email || null },
  });
  return paraTela(conta);
}

/**
 * Troca o nome e/ou a chave (chave vazia mantem a atual).
 * @param {number|string} id
 * @param {{nome?: string, apiKey?: string}} dados
 * @param {object} user
 */
async function atualizar(id, dados, user) {
  await buscarConta(id);
  const data = { updatedBy: user?.email || null };

  const nome = String(dados?.nome ?? "").trim();
  if (nome) {
    data.nome = nome;
  }
  const apiKey = String(dados?.apiKey ?? "").trim();
  if (apiKey) {
    Object.assign(data, { apiKey }, await validarChave(apiKey));
  }

  const conta = await prisma.sumupConta.update({ where: { id: Number(id) }, data });
  return paraTela(conta);
}

async function excluir(id) {
  await buscarConta(id);
  await prisma.sumupConta.delete({ where: { id: Number(id) } });
}

/**
 * Maquininhas pareadas na Cloud API desta conta.
 * @param {number|string} id
 */
async function listarMaquininhas(id) {
  const conta = await buscarConta(id);
  const merchantCode = conta.merchantCode || (await validarChave(conta.apiKey)).merchantCode;
  const resposta = await chamarSumup(
    conta.apiKey,
    `/v0.1/merchants/${encodeURIComponent(merchantCode)}/readers`,
  );
  const itens = Array.isArray(resposta)
    ? resposta
    : resposta?.items || resposta?.readers || resposta?.data || [];

  return itens.map((item) => ({
    id: String(item.id ?? item.reader_id),
    nome: item.name || null,
    status: item.status || null,
    serial: item.device?.identifier || null,
    modelo: item.device?.model || null,
    criadoEm: item.created_at || null,
  }));
}

/**
 * Apaga a maquininha da conta. Depois ela precisa ser desconectada no
 * aparelho (Menu > Conexoes > API > Desconectar) para mostrar o codigo de novo.
 * @param {number|string} id
 * @param {string} readerId
 */
async function esquecerMaquininha(id, readerId) {
  const conta = await buscarConta(id);
  const merchantCode = conta.merchantCode || (await validarChave(conta.apiKey)).merchantCode;
  await chamarSumup(
    conta.apiKey,
    `/v0.1/merchants/${encodeURIComponent(merchantCode)}/readers/${encodeURIComponent(readerId)}`,
    { method: "DELETE" },
  );
}

module.exports = {
  listar,
  criar,
  atualizar,
  excluir,
  listarMaquininhas,
  esquecerMaquininha,
};

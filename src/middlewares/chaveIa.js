const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");

/**
 * Acesso da IA Central (ia-central) por chave de API, sem login e sem token
 * vencendo. A chave fica em IA_CENTRAL_API_KEY (Render) e vem no cabecalho
 * X-API-Key. Quem entra com ela vira o usuario "Integracao IA" (ADMIN, criado
 * na primeira chamada, com senha aleatoria: ninguem faz login com ele).
 *
 * Acesso total, como um ADMIN: o Maestro faz o que o Gabriel e o Leo pedirem
 * (as escritas so saem depois do "sim" deles, do lado da ia-central).
 * Desativar o usuario "Integracao IA" corta a chave.
 */
const EMAIL_IA = "ia-central@integracao.grupogk";

function chaveIaConfere(req) {
  const esperado = process.env.IA_CENTRAL_API_KEY || "";
  const recebido = String(req.headers["x-api-key"] || "");
  if (esperado.length < 32 || !recebido) return false;
  const a = crypto.createHash("sha256").update(recebido).digest();
  const b = crypto.createHash("sha256").update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

let cache = null;
async function usuarioIa() {
  if (cache && Date.now() - cache.at < 60000) return cache.usuario;
  const usuario = await prisma.usuario.upsert({
    where: { email: EMAIL_IA },
    update: {},
    create: {
      nome: "Integracao IA (ia-central)",
      email: EMAIL_IA,
      // senha aleatoria que ninguem conhece: nao da para logar
      senhaHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
      perfil: "ADMIN",
    },
  });
  cache = { at: Date.now(), usuario };
  return usuario;
}

module.exports = { EMAIL_IA, chaveIaConfere, usuarioIa };

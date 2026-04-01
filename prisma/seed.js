const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

/**
 * Popula as empresas padrao do Grupo GK.
 * @returns {Promise<void>}
 */
async function seedEmpresas() {
  const empresas = [
    "AgarraMais",
    "MachinePay",
    "MaisQuiosque",
    "GiraKids",
    "SelfMachine",
  ];

  await Promise.all(
    empresas.map((nome) =>
      prisma.empresa.upsert({
        where: { nome },
        update: {},
        create: { nome },
      }),
    ),
  );
}

/**
 * Cria ou atualiza usuario admin padrao para acesso inicial.
 * @returns {Promise<void>}
 */
async function seedAdminUsuario() {
  const nome = process.env.SEED_ADMIN_NOME || "Administrador";
  const email = process.env.SEED_ADMIN_EMAIL || "admin@grupogk.com";
  const senha = process.env.SEED_ADMIN_PASSWORD || "Admin@123";
  const senhaHash = await bcrypt.hash(senha, 10);

  await prisma.usuario.upsert({
    where: { email },
    update: {
      nome,
      senhaHash,
      perfil: "ADMIN",
      ativo: true,
    },
    create: {
      nome,
      email,
      senhaHash,
      perfil: "ADMIN",
      ativo: true,
    },
  });
}

/**
 * Executa a carga inicial do banco.
 * @returns {Promise<void>}
 */
async function main() {
  await seedEmpresas();
  await seedAdminUsuario();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Erro ao executar seed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });

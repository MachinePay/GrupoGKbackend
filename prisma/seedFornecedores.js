const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const FORNECEDORES = [
  { nome: "All American", descricao: "Distribuidor All American" },
  { nome: "BrinqColor", descricao: "Fornecedor BrinqColor" },
  { nome: "MiniToys", descricao: "Fornecedor MiniToys" },
  { nome: "IrmasPlastic", descricao: "Fornecedor IrmasPlastic" },
  { nome: "Chacrinha", descricao: "Fornecedor Chacrinha" },
  { nome: "Chinês", descricao: "Fornecedor Chinês" },
  { nome: "Sleeve", descricao: "Fornecedor Sleeve" },
  { nome: "VendMania", descricao: "Fornecedor VendMania" },
  { nome: "Geleca", descricao: "Fornecedor Geleca" },
  { nome: "Pelúcias", descricao: "Fornecedor Pelúcias" },
  { nome: "Rovaldo", descricao: "Fornecedor Rovaldo" },
  { nome: "Fabiano", descricao: "Fornecedor Fabiano" },
];

async function main() {
  console.log("🌱 Iniciando seed de fornecedores...");

  for (const fornecedor of FORNECEDORES) {
    const existing = await prisma.fornecedor.findUnique({
      where: { nome: fornecedor.nome },
    });

    if (existing) {
      console.log(`✓ Fornecedor "${fornecedor.nome}" já existe`);
    } else {
      const created = await prisma.fornecedor.create({
        data: fornecedor,
      });
      console.log(`✓ Fornecedor "${created.nome}" criado (ID: ${created.id})`);
    }
  }

  console.log("✅ Seed de fornecedores concluído!");
}

main()
  .catch((e) => {
    console.error("❌ Erro ao fazer seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

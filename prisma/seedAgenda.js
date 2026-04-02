// Seed de itens de agenda para teste - Calendário e Contas a Pagar
// Execute com: node prisma/seedAgenda.js
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // Busca os IDs das empresas pelo nome para não depender de IDs fixos
  const empresas = await prisma.empresa.findMany({
    select: { id: true, nome: true },
  });

  const byNome = Object.fromEntries(empresas.map((e) => [e.nome, e.id]));

  const testeAlfa = byNome["Teste Alfa"];
  const giraKids = byNome["GiraKids"];
  const maisQuiosque = byNome["MaisQuiosque"];
  const testeBeta = byNome["Teste Beta"];

  if (!testeAlfa || !giraKids || !maisQuiosque) {
    throw new Error(
      "Empresas de teste não encontradas. Cadastre as empresas primeiro.",
    );
  }

  const itens = [
    // ─── PAGAR ──────────────────────────────────────────────────────────────
    {
      titulo: "Aluguel Sede - Abril/2026",
      tipo: "PAGAR",
      prioridade: "ALTA",
      status: "PREVISTO",
      data: new Date("2026-04-05"),
      valor: new Prisma.Decimal(2500),
      empresaId: testeAlfa,
      origem: "Proprietário Imóvel",
      descricao: "Aluguel mensal da sede administrativa",
    },
    {
      titulo: "Internet e Telefonia",
      tipo: "PAGAR",
      prioridade: "BAIXA",
      status: "PREVISTO",
      data: new Date("2026-04-10"),
      valor: new Prisma.Decimal(350),
      empresaId: testeAlfa,
      origem: "Vivo Empresas",
    },
    {
      titulo: "Reposição de Estoque",
      tipo: "PAGAR",
      prioridade: "MEDIA",
      status: "PREVISTO",
      data: new Date("2026-04-12"),
      valor: new Prisma.Decimal(1200),
      empresaId: maisQuiosque,
      origem: "Fornecedor Central Ltda",
      descricao: "Reposição mensal de produtos para quiosques",
    },
    {
      titulo: "Contrato TakeParceria - Abril",
      tipo: "PAGAR",
      prioridade: "ALTA",
      status: "PREVISTO",
      data: new Date("2026-04-15"),
      valor: new Prisma.Decimal(900),
      empresaId: giraKids,
      origem: "Take Parceria",
    },
    {
      titulo: "Serviços Contábeis",
      tipo: "PAGAR",
      prioridade: "MEDIA",
      status: "PREVISTO",
      data: new Date("2026-04-18"),
      valor: new Prisma.Decimal(600),
      empresaId: testeBeta ?? testeAlfa,
      origem: "Escritório de Contabilidade",
    },
    {
      titulo: "Manutenção Equipamentos",
      tipo: "PAGAR",
      prioridade: "BAIXA",
      status: "ATRASADO",
      data: new Date("2026-03-28"),
      valor: new Prisma.Decimal(480),
      empresaId: maisQuiosque,
      origem: "Técnico Autorizado",
      descricao: "Manutenção preventiva dos equipamentos dos quiosques",
    },
    {
      titulo: "Folha de Pagamento - Abril/2026",
      tipo: "PAGAR",
      prioridade: "ALTA",
      status: "PREVISTO",
      data: new Date("2026-04-30"),
      valor: new Prisma.Decimal(4800),
      empresaId: testeAlfa,
      origem: "RH",
      descricao: "Salários e encargos do mês de abril",
    },

    // ─── RECEBER ────────────────────────────────────────────────────────────
    {
      titulo: "Pedido Cliente Premium - ABR",
      tipo: "RECEBER",
      prioridade: "ALTA",
      status: "PREVISTO",
      data: new Date("2026-04-08"),
      valor: new Prisma.Decimal(3500),
      empresaId: testeAlfa,
      origem: "Cliente Premium SA",
      descricao: "Pedido mensal contrato anual",
    },
    {
      titulo: "Recolhimento Lojas - Semana 1",
      tipo: "RECEBER",
      prioridade: "MEDIA",
      status: "PREVISTO",
      data: new Date("2026-04-07"),
      valor: new Prisma.Decimal(1800),
      empresaId: maisQuiosque,
      origem: "Lojas Shopping Centro",
    },
    {
      titulo: "Comissão Canal Marketplace",
      tipo: "RECEBER",
      prioridade: "MEDIA",
      status: "PREVISTO",
      data: new Date("2026-04-20"),
      valor: new Prisma.Decimal(750),
      empresaId: testeAlfa,
      origem: "Marketplace Digital",
    },
    {
      titulo: "Parceria TakeParceria - Repasse",
      tipo: "RECEBER",
      prioridade: "ALTA",
      status: "PREVISTO",
      data: new Date("2026-04-22"),
      valor: new Prisma.Decimal(1100),
      empresaId: giraKids,
      origem: "Take Parceria",
      descricao: "Repasse da parceria de pelucias",
    },
    {
      titulo: "Recolhimento Lojas - Semana 2",
      tipo: "RECEBER",
      prioridade: "MEDIA",
      status: "PREVISTO",
      data: new Date("2026-04-14"),
      valor: new Prisma.Decimal(2200),
      empresaId: maisQuiosque,
      origem: "Lojas Shopping Morumbi",
    },
  ];

  console.log(`\nCriando ${itens.length} itens de agenda para teste...\n`);

  for (const item of itens) {
    const created = await prisma.agenda.create({ data: item });
    console.log(
      `  ✓ [${created.status.padEnd(8)}] ${created.tipo.padEnd(7)} R$${Number(created.valor).toFixed(2).padStart(9)} — ${created.titulo}`,
    );
  }

  console.log("\n✅ Seed de agenda concluído com sucesso!\n");

  // Resumo dos saldos iniciais para referência
  const contas = await prisma.contaBancaria.findMany({
    include: { empresa: { select: { nome: true } } },
    orderBy: { id: "asc" },
  });

  console.log("─── Saldos atuais das contas bancárias ────────────────");
  for (const c of contas) {
    console.log(
      `  ${(c.banco + " – " + c.nome).padEnd(35)} R$ ${Number(c.saldoAtual).toFixed(2).padStart(9)}  (${c.empresa.nome})`,
    );
  }
  console.log("────────────────────────────────────────────────────────\n");
}

main()
  .catch((err) => {
    console.error("❌ Erro ao executar seed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

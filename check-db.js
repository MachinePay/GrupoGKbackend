const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    const contas = await prisma.conta.findMany();
    console.log(`Ì≥ä CONTAS: ${contas.length} encontradas`);
    contas.forEach(c => console.log(`   - ${c.id}: ${c.nome} (${c.saldoAtual})`));
    
    const fornecedores = await prisma.fornecedor.findMany();
    console.log(`\nÌ≥ä FORNECEDORES: ${fornecedores.length} encontrados`);
    
    const empresas = await prisma.empresa.findMany();
    console.log(`\nÌ≥ä EMPRESAS: ${empresas.length} encontradas`);
    
  } catch(e) {
    console.error('‚ùå ERRO:', e.message);
  }
  await prisma.$disconnect();
})();

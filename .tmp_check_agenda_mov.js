const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const agendas = await prisma.agenda.findMany({
      where: {
        OR: [
          { titulo: { contains: 'AGARRAMAIS', mode: 'insensitive' } },
          { titulo: { contains: 'Folha de Pagamento', mode: 'insensitive' } },
          { titulo: { contains: 'teste', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        data: true,
        titulo: true,
        status: true,
        tipo: true,
        valor: true,
        empresaId: true,
        origemExterna: true,
        origem: true,
        referenciaExternaId: true,
      },
    });

    console.log('AGENDA ENCONTRADA:', agendas.length);
    for (const a of agendas) {
      const referenciaAprovacao = a.referenciaExternaId
        ? `Aprovado via AgarraMais - ${a.referenciaExternaId}`
        : null;

      const movs = await prisma.movimentacao.findMany({
        where: {
          empresaId: a.empresaId,
          status: 'REALIZADO',
          tipo: a.tipo === 'PAGAR' ? 'SAIDA' : 'ENTRADA',
          OR: [
            referenciaAprovacao ? { referencia: referenciaAprovacao } : undefined,
            { referencia: a.titulo },
            { referencia: { startsWith: `${a.titulo} -` } },
          ].filter(Boolean),
        },
        select: {
          id: true,
          data: true,
          valor: true,
          referencia: true,
          contaOrigemId: true,
          contaDestinoId: true,
          status: true,
          tipo: true,
        },
      });

      console.log('\n---');
      console.log(JSON.stringify({
        agendaId: a.id,
        data: a.data.toISOString().slice(0,10),
        titulo: a.titulo,
        status: a.status,
        tipo: a.tipo,
        valor: String(a.valor),
        empresaId: a.empresaId,
        origemExterna: a.origemExterna,
        origem: a.origem,
        referenciaExternaId: a.referenciaExternaId,
        movimentacoesRelacionadas: movs.length,
      }, null, 2));

      if (movs.length) {
        console.log(JSON.stringify(movs, null, 2));
      }
    }
  } catch (e) {
    console.error('ERRO', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();

-- Machine Pay: sincronizacao com o painel (cliente do painel, maquinas ON/OFF e ON inativas)
ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "maquinas_on_inativas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "painel_usr_id" TEXT,
  ADD COLUMN IF NOT EXISTS "painel_sincronizado_em" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "machinepay_clientes_painel_usr_id_key"
  ON "machinepay_clientes"("painel_usr_id");

CREATE TABLE IF NOT EXISTS "machinepay_maquinas" (
  "id" SERIAL NOT NULL,
  "cliente_id" INTEGER NOT NULL,
  "pos_id" TEXT NOT NULL,
  "id_painel" TEXT,
  "nome" TEXT,
  "ligada" BOOLEAN NOT NULL DEFAULT true,
  "online" BOOLEAN,
  "ultima_venda_em" TIMESTAMP(3),
  "inativa" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_maquinas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "machinepay_maquinas_cliente_id_fkey" FOREIGN KEY ("cliente_id")
    REFERENCES "machinepay_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "machinepay_maquinas_pos_id_key" ON "machinepay_maquinas"("pos_id");
CREATE INDEX IF NOT EXISTS "machinepay_maquinas_cliente_id_idx" ON "machinepay_maquinas"("cliente_id");

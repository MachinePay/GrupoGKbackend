-- Machine Pay: maquinas de parceria (sem cobranca ou com valor combinado por maquina)
ALTER TYPE "MachinePayTipoMaquina" ADD VALUE IF NOT EXISTS 'PARCERIA';

ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "maquinas_parceria" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "valor_mensalidade_parceria" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "machinepay_cobrancas"
  ADD COLUMN IF NOT EXISTS "maquinas_parceria" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "valor_mensalidade_parceria" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Machine Pay: cobranca agrupada (cliente cobrado junto com um responsavel)
ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "agrupado_com_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'machinepay_clientes_agrupado_com_id_fkey'
  ) THEN
    ALTER TABLE "machinepay_clientes"
      ADD CONSTRAINT "machinepay_clientes_agrupado_com_id_fkey"
      FOREIGN KEY ("agrupado_com_id") REFERENCES "machinepay_clientes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "machinepay_cobrancas"
  ADD COLUMN IF NOT EXISTS "itens" JSONB;

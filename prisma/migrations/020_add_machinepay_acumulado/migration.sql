-- Machine Pay: cobranca nao paga e somada na cobranca do mes seguinte
ALTER TYPE "MachinePayStatusCobranca" ADD VALUE IF NOT EXISTS 'ACUMULADA';

ALTER TABLE "machinepay_cobrancas"
  ADD COLUMN IF NOT EXISTS "valor_anterior" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "meses_anteriores" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "anteriores" JSONB,
  ADD COLUMN IF NOT EXISTS "acumulada_em_id" INTEGER;

CREATE INDEX IF NOT EXISTS "machinepay_cobrancas_acumulada_em_id_idx"
  ON "machinepay_cobrancas"("acumulada_em_id");

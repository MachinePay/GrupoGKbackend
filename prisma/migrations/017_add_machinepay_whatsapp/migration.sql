-- Machine Pay: envio automatico de cobrancas no WhatsApp (Evolution API)
CREATE TABLE IF NOT EXISTS "machinepay_whatsapp_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "ativo" BOOLEAN NOT NULL DEFAULT false,
  "evolution_url" TEXT,
  "api_key" TEXT,
  "instancia" TEXT,
  "intervalo_segundos" INTEGER NOT NULL DEFAULT 20,
  "updated_by" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_whatsapp_config_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "machinepay_cobrancas"
  ADD COLUMN IF NOT EXISTS "whatsapp_status" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsapp_enviado_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsapp_erro" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsapp_na_fila_em" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "machinepay_cobrancas_whatsapp_status_idx"
  ON "machinepay_cobrancas"("whatsapp_status");

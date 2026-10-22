-- Machine Pay: Pix dinamico via SumUp (configuracao da conta e Pix por cobranca)
CREATE TABLE IF NOT EXISTS "machinepay_sumup_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "ativo" BOOLEAN NOT NULL DEFAULT false,
  "api_key" TEXT,
  "merchant_code" TEXT,
  "tipo_pix" TEXT NOT NULL DEFAULT 'pix',
  "validade_horas" INTEGER NOT NULL DEFAULT 72,
  "conta_destino_id" INTEGER,
  "url_publica" TEXT,
  "webhook_token" TEXT,
  "updated_by" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_sumup_config_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "machinepay_cobrancas"
  ADD COLUMN IF NOT EXISTS "sumup_checkout_id" TEXT,
  ADD COLUMN IF NOT EXISTS "sumup_referencia" TEXT,
  ADD COLUMN IF NOT EXISTS "pix_copia_cola" TEXT,
  ADD COLUMN IF NOT EXISTS "pix_qr_url" TEXT,
  ADD COLUMN IF NOT EXISTS "pix_gerado_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pix_valido_ate" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "machinepay_cobrancas_sumup_checkout_id_key"
  ON "machinepay_cobrancas"("sumup_checkout_id");

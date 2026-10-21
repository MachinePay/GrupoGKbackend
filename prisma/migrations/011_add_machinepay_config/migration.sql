-- Machine Pay: configuracao global (cobranca ativa ou apenas cadastro)
CREATE TABLE IF NOT EXISTS "machinepay_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "cobranca_ativa" BOOLEAN NOT NULL DEFAULT false,
  "updated_by" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_config_pkey" PRIMARY KEY ("id")
);

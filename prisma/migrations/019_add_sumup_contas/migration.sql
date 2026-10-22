-- Contas SumUp do grupo (uma por empresa/sistema), para gerenciar as
-- maquininhas pareadas na Cloud API de cada uma.
CREATE TABLE IF NOT EXISTS "sumup_contas" (
  "id" SERIAL NOT NULL,
  "nome" TEXT NOT NULL,
  "api_key" TEXT NOT NULL,
  "merchant_code" TEXT,
  "nome_conta" TEXT,
  "updated_by" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sumup_contas_pkey" PRIMARY KEY ("id")
);

-- Add optional infrastructure cost fields to SaaS contracts (servidor, banco de dados, frontend, outros)
ALTER TABLE "saas_clientes"
  ADD COLUMN IF NOT EXISTS "custo_servidor" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "custo_banco_dados" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "custo_frontend" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "custo_outros" DECIMAL(14,2);

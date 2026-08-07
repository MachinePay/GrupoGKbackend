-- Remove Numero do PC / Tipo de Remessa from SaaS contracts (dropped from form and PDFs)
-- and add link do sistema + credenciais de admin (form-only fields)
ALTER TABLE "saas_clientes"
  DROP COLUMN IF EXISTS "numero_pc",
  DROP COLUMN IF EXISTS "tipo_remessa",
  ADD COLUMN IF NOT EXISTS "link_sistema" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_email" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_senha" TEXT;

DROP TYPE IF EXISTS "TipoRemessa";

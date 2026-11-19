-- Machine Pay e CompactPay no mesmo modulo: produto por cliente, ligacao com
-- o CompactPay, faixas de valor e configuracao por produto.
DO $$ BEGIN
  CREATE TYPE "MachinePayProduto" AS ENUM ('MACHINEPAY', 'COMPACTPAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "produto" "MachinePayProduto" NOT NULL DEFAULT 'MACHINEPAY',
  ADD COLUMN IF NOT EXISTS "compactpay_id" TEXT,
  ADD COLUMN IF NOT EXISTS "compactpay_sincronizado_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "faixas" JSONB,
  ADD COLUMN IF NOT EXISTS "valores_personalizados" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "machinepay_clientes_compactpay_id_key"
  ON "machinepay_clientes"("compactpay_id");
CREATE INDEX IF NOT EXISTS "machinepay_clientes_produto_status_idx"
  ON "machinepay_clientes"("produto", "status");

CREATE TABLE IF NOT EXISTS "machinepay_produto_config" (
  "produto" "MachinePayProduto" NOT NULL,
  "cobranca_ativa" BOOLEAN NOT NULL DEFAULT false,
  "marca" TEXT NOT NULL,
  "chave_pix" TEXT,
  "integracao_url" TEXT,
  "integracao_key" TEXT,
  "mensagem_lembrete" TEXT,
  "mensagem_atraso" TEXT,
  "updated_by" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_produto_config_pkey" PRIMARY KEY ("produto")
);

-- Machine Pay herda a chave "cobranca ativa" que ja existia.
INSERT INTO "machinepay_produto_config" ("produto", "cobranca_ativa", "marca", "chave_pix", "updatedAt")
SELECT 'MACHINEPAY',
       COALESCE((SELECT "cobranca_ativa" FROM "machinepay_config" WHERE "id" = 1), false),
       'MachinePay', '59996204000177', CURRENT_TIMESTAMP
ON CONFLICT ("produto") DO NOTHING;

INSERT INTO "machinepay_produto_config" ("produto", "cobranca_ativa", "marca", "chave_pix", "integracao_url", "updatedAt")
VALUES ('COMPACTPAY', false, 'CompactPay', '59996204000177', 'https://compactpayback.onrender.com/api/v1', CURRENT_TIMESTAMP)
ON CONFLICT ("produto") DO NOTHING;

INSERT INTO "Empresa" ("nome", "createdAt", "updatedAt")
VALUES ('CompactPay', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("nome") DO NOTHING;

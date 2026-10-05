-- Cotacoes de moedas estrangeiras em reais (editaveis em Configuracoes)
CREATE TABLE IF NOT EXISTS "cotacoes_moeda" (
  "moeda" TEXT NOT NULL,
  "valor_em_reais" DECIMAL(14,4) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cotacoes_moeda_pkey" PRIMARY KEY ("moeda")
);

-- Valores iniciais (cotacao de 05/10/2026)
INSERT INTO "cotacoes_moeda" ("moeda", "valor_em_reais") VALUES
  ('USD', 4.99),
  ('EUR', 5.86)
ON CONFLICT ("moeda") DO NOTHING;

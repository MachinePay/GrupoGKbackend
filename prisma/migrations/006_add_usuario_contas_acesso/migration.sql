-- Create explicit user-account access table for multiple accounts per user
CREATE TABLE IF NOT EXISTS "usuarios_contas_acesso" (
  "id" SERIAL PRIMARY KEY,
  "usuario_id" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "conta_bancaria_id" INTEGER NOT NULL REFERENCES "contas_bancarias"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usuarios_contas_acesso_usuario_id_conta_bancaria_id_key" UNIQUE ("usuario_id", "conta_bancaria_id")
);

CREATE INDEX IF NOT EXISTS "usuarios_contas_acesso_conta_bancaria_id_idx"
  ON "usuarios_contas_acesso"("conta_bancaria_id");

-- Backfill legacy single-account links into the new access table
INSERT INTO "usuarios_contas_acesso" ("usuario_id", "conta_bancaria_id")
SELECT "id", "conta_bancaria_id"
FROM "usuarios"
WHERE "conta_bancaria_id" IS NOT NULL
ON CONFLICT ("usuario_id", "conta_bancaria_id") DO NOTHING;

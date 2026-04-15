-- Add CAIXA profile to PerfilUsuario enum
ALTER TYPE "PerfilUsuario" ADD VALUE IF NOT EXISTS 'CAIXA';

-- Add contaBancariaId to usuarios
ALTER TABLE "usuarios" ADD COLUMN "conta_bancaria_id" INTEGER;
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_conta_bancaria_id_fkey" FOREIGN KEY ("conta_bancaria_id") REFERENCES "contas_bancarias"("id");

-- Add usuarioCriacaoId to agenda
ALTER TABLE "agenda" ADD COLUMN "usuario_criacao_id" INTEGER;
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_usuario_criacao_id_fkey" FOREIGN KEY ("usuario_criacao_id") REFERENCES "usuarios"("id");

-- Create index for usuario_criacao_id
CREATE INDEX "agenda_usuario_criacao_id_idx" ON "agenda"("usuario_criacao_id");

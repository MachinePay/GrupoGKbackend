-- Machine Pay: cliente sem mensalidade (fica no cadastro, mas nao gera cobranca)
ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "sem_mensalidade" BOOLEAN NOT NULL DEFAULT false;

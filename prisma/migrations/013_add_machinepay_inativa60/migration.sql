-- Machine Pay: aviso de maquina ON sem venda em todo o historico do painel (60 dias)
ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "maquinas_on_inativas60" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "machinepay_maquinas"
  ADD COLUMN IF NOT EXISTS "inativa60" BOOLEAN NOT NULL DEFAULT false;

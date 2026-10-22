-- Machine Pay: revenda do cliente no painel (Machine Pay, Clube Kids, Star Toys...)
ALTER TABLE "machinepay_clientes"
  ADD COLUMN IF NOT EXISTS "painel_revenda" TEXT;

-- Machine Pay: clientes e cobrancas mensais por maquina
DO $$ BEGIN
  CREATE TYPE "MachinePayStatusCliente" AS ENUM ('ATIVO', 'SUSPENSO', 'INATIVO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MachinePayStatusCobranca" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MachinePayTipoMaquina" AS ENUM ('PROPRIA', 'PLANO36', 'OFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "machinepay_clientes" (
  "id" SERIAL NOT NULL,
  "nome" TEXT NOT NULL,
  "documento" TEXT,
  "telefone" TEXT,
  "email" TEXT,
  "dia_vencimento" INTEGER NOT NULL DEFAULT 10,
  "maquinas_proprias" INTEGER NOT NULL DEFAULT 0,
  "maquinas_plano36" INTEGER NOT NULL DEFAULT 0,
  "maquinas_off" INTEGER NOT NULL DEFAULT 0,
  "valor_mensalidade" DECIMAL(14,2) NOT NULL DEFAULT 40,
  "valor_mensalidade36" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "valor_fixo" DECIMAL(14,2),
  "status" "MachinePayStatusCliente" NOT NULL DEFAULT 'ATIVO',
  "observacoes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_clientes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "machinepay_clientes_status_idx" ON "machinepay_clientes"("status");

CREATE TABLE IF NOT EXISTS "machinepay_cobrancas" (
  "id" SERIAL NOT NULL,
  "cliente_id" INTEGER NOT NULL,
  "competencia" TEXT NOT NULL,
  "vencimento" TIMESTAMP(3) NOT NULL,
  "maquinas_proprias" INTEGER NOT NULL DEFAULT 0,
  "maquinas_plano36" INTEGER NOT NULL DEFAULT 0,
  "valor_mensalidade" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "valor_mensalidade36" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "valor" DECIMAL(14,2) NOT NULL,
  "status" "MachinePayStatusCobranca" NOT NULL DEFAULT 'PENDENTE',
  "valor_pago" DECIMAL(14,2),
  "pago_em" TIMESTAMP(3),
  "forma_pagamento" TEXT,
  "movimentacao_id" INTEGER,
  "observacoes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "machinepay_cobrancas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "machinepay_cobrancas_cliente_id_fkey" FOREIGN KEY ("cliente_id")
    REFERENCES "machinepay_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "machinepay_cobrancas_cliente_id_competencia_key"
  ON "machinepay_cobrancas"("cliente_id", "competencia");
CREATE INDEX IF NOT EXISTS "machinepay_cobrancas_competencia_status_idx"
  ON "machinepay_cobrancas"("competencia", "status");

CREATE TABLE IF NOT EXISTS "machinepay_ajustes_maquinas" (
  "id" SERIAL NOT NULL,
  "cliente_id" INTEGER NOT NULL,
  "tipo" "MachinePayTipoMaquina" NOT NULL,
  "quantidade" INTEGER NOT NULL,
  "motivo" TEXT,
  "usuario" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machinepay_ajustes_maquinas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "machinepay_ajustes_maquinas_cliente_id_fkey" FOREIGN KEY ("cliente_id")
    REFERENCES "machinepay_clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "machinepay_ajustes_maquinas_cliente_id_createdAt_idx"
  ON "machinepay_ajustes_maquinas"("cliente_id", "createdAt");

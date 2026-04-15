-- Add new movement type for direct balance adjustments
ALTER TYPE "MovimentacaoTipo" ADD VALUE IF NOT EXISTS 'AJUSTE_SALDO';

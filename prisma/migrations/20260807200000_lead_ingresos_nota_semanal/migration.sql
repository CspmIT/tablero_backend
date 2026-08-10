-- Migración 13 (ola 3, 07/08) — ADITIVA, no toca datos existentes.
-- 1. Lead: abono mensual genérico + fecha de ganado (solapa Ingresos).
ALTER TABLE `Lead` ADD COLUMN `abonoMensualUsd` DECIMAL(14, 2) NULL;
ALTER TABLE `Lead` ADD COLUMN `fechaGanado` DATE NULL;

-- 2. Mis notas: texto libre semanal por colaborador (patrón WeeklyWip).
CREATE TABLE `NotaSemanal` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `colaboradorId` INTEGER NOT NULL,
  `anio` INTEGER NOT NULL,
  `semanaIso` INTEGER NOT NULL,
  `texto` TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `NotaSemanal_colaboradorId_anio_semanaIso_key`(`colaboradorId`, `anio`, `semanaIso`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NotaSemanal` ADD CONSTRAINT `NotaSemanal_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

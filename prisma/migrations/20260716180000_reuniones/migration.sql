-- Ola de reuniones: ciclo de vida (crear/reprogramar/cancelar) + Outlook.
CREATE TABLE `Reunion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tipo` VARCHAR(191) NOT NULL,
  `titulo` VARCHAR(191) NOT NULL,
  `fecha` DATE NOT NULL,
  `horaInicio` VARCHAR(191) NOT NULL,
  `horaFin` VARCHAR(191) NOT NULL,
  `modalidad` ENUM('virtual','presencial') NOT NULL DEFAULT 'virtual',
  `lugar` VARCHAR(191) NULL,
  `organizadorId` INTEGER NULL,
  `leadId` INTEGER NULL,
  `crmActividadId` INTEGER NULL,
  `colaboradoresIds` JSON NOT NULL,
  `graphEventId` VARCHAR(191) NULL,
  `casilla` VARCHAR(191) NULL,
  `joinUrl` TEXT NULL,
  `estado` ENUM('activa','cancelada') NOT NULL DEFAULT 'activa',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Reunion_fecha_estado_idx`(`fecha`, `estado`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CrmActividad` ADD COLUMN `cancelada` BOOLEAN NOT NULL DEFAULT false;

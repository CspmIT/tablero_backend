-- Tareas de seguimiento por lead (pendientes con fecha límite y resultado).
CREATE TABLE `LeadTarea` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `leadId` INTEGER NOT NULL,
  `texto` TEXT NOT NULL,
  `fechaLimite` DATE NULL,
  `done` BOOLEAN NOT NULL DEFAULT false,
  `resultado` TEXT NULL,
  `creadorId` INTEGER NULL,
  `completadoAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `LeadTarea_leadId_done_idx`(`leadId`, `done`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LeadTarea` ADD CONSTRAINT `LeadTarea_leadId_fkey`
  FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

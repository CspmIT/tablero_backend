-- Web Push: suscripciones por colaborador (notificaciones app cerrada).
CREATE TABLE `PushSuscripcion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `colaboradorId` INTEGER NOT NULL,
  `endpoint` VARCHAR(500) NOT NULL,
  `datos` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PushSuscripcion_endpoint_key`(`endpoint`),
  INDEX `PushSuscripcion_colaboradorId_idx`(`colaboradorId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

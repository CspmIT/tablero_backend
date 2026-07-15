-- Módulo "Mis Deseos": pedidos de desarrollo con estados y pase al kanban.
CREATE TABLE `Deseo` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(191) NOT NULL,
  `descripcion` TEXT NOT NULL,
  `solicitanteId` INTEGER NOT NULL,
  `fechaNecesidad` DATE NULL,
  `estado` ENUM('borrador','enviado','en_revision','aprobado','rechazado','requiere_cambios') NOT NULL DEFAULT 'borrador',
  `respuesta` TEXT NULL,
  `respondidoPorId` INTEGER NULL,
  `respondidoAt` DATETIME(3) NULL,
  `tareaId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Deseo_solicitanteId_estado_idx`(`solicitanteId`, `estado`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

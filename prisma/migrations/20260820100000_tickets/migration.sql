-- Inbox → Tickets (20/08): mini sistema de tickets espejo de la Mesa de ayuda.
-- ADITIVA: solo crea tablas nuevas, no toca nada existente.
CREATE TABLE `Ticket` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `sector` VARCHAR(191) NULL,
  `titulo` VARCHAR(191) NOT NULL,
  `tipo` VARCHAR(191) NOT NULL DEFAULT 'Incidente',
  `prioridad` VARCHAR(191) NOT NULL DEFAULT 'Media',
  `area` VARCHAR(191) NOT NULL DEFAULT 'Desarrollo',
  `copiarA` TEXT NULL,
  `descripcion` TEXT NOT NULL,
  `estado` ENUM('abierto','en_proceso','resuelto','cerrado') NOT NULL DEFAULT 'abierto',
  `origen` ENUM('manual','whatsapp','mesa_ayuda') NOT NULL DEFAULT 'manual',
  `externalId` VARCHAR(191) NULL,
  `solicitante` VARCHAR(191) NULL,
  `creadoPorId` INTEGER NULL,
  `asignadoAId` INTEGER NULL,
  `ovTipo` VARCHAR(191) NULL,
  `ovCausa` VARCHAR(191) NULL,
  `categoriaFalla` VARCHAR(191) NULL,
  `grillaEntradaId` INTEGER NULL,
  `grillaItemId` VARCHAR(191) NULL,
  `ocurridoAt` DATETIME(3) NULL,
  `resueltoAt` DATETIME(3) NULL,
  `cerradoAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Ticket_externalId_key`(`externalId`),
  INDEX `Ticket_estado_area_idx`(`estado`, `area`),
  INDEX `Ticket_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TicketMensaje` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ticketId` INTEGER NOT NULL,
  `autorId` INTEGER NULL,
  `autor` VARCHAR(191) NULL,
  `texto` TEXT NOT NULL,
  `externalId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TicketMensaje_externalId_key`(`externalId`),
  INDEX `TicketMensaje_ticketId_idx`(`ticketId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

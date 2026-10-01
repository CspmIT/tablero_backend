-- Consultas web de la landing (28/09): bandeja de entrada de leads.
-- SOLO CREATE TABLE — aditiva, no toca nada existente.
CREATE TABLE `LandingConsulta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `producto` VARCHAR(40) NOT NULL,
    `organizacion` VARCHAR(191) NOT NULL,
    `contacto` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `telefono` VARCHAR(191) NULL,
    `localidad` VARCHAR(191) NULL,
    `mensaje` TEXT NULL,
    `detalle` TEXT NULL,
    `origenUrl` VARCHAR(300) NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'nueva',
    `leadId` INTEGER NULL,
    `ip` VARCHAR(60) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LandingConsulta_estado_idx`(`estado`),
    INDEX `LandingConsulta_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

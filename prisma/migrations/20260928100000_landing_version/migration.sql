-- Landing pública de Cooptech (28/09): versiones PUBLICADAS del módulo
-- Marketing → Landing (el borrador vive en Configuracion). SOLO CREATE TABLE
-- — aditiva, no toca nada existente.
CREATE TABLE `LandingVersion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` INTEGER NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `publicadoPor` VARCHAR(191) NULL,
    `notas` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LandingVersion_numero_key`(`numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

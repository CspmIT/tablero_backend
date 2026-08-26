-- Marketing (26/08): campañas publicitarias con período en el calendario.
-- SOLO CREATE TABLE — no toca nada existente.
CREATE TABLE `MarketingCampania` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `producto` VARCHAR(191) NULL,
    `presupuesto` VARCHAR(191) NULL,
    `desarrollo` TEXT NULL,
    `aprobada` BOOLEAN NOT NULL DEFAULT false,
    `desde` DATE NULL,
    `hasta` DATE NULL,
    `creadoPorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MarketingCampaniaArchivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaniaId` INTEGER NOT NULL,
    `archivoId` INTEGER NOT NULL,
    UNIQUE INDEX `MarketingCampaniaArchivo_campaniaId_archivoId_key`(`campaniaId`, `archivoId`),
    INDEX `MarketingCampaniaArchivo_archivoId_idx`(`archivoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MarketingCampaniaArchivo` ADD CONSTRAINT `MarketingCampaniaArchivo_campaniaId_fkey` FOREIGN KEY (`campaniaId`) REFERENCES `MarketingCampania`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MarketingCampaniaArchivo` ADD CONSTRAINT `MarketingCampaniaArchivo_archivoId_fkey` FOREIGN KEY (`archivoId`) REFERENCES `Archivo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

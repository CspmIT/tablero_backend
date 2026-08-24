-- Marketing ola 3 (21/08): calendario de publicaciones del mes.
-- SOLO CREATE TABLE — no toca ninguna tabla existente.
CREATE TABLE `MarketingPost` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mes` VARCHAR(191) NOT NULL,
    `dia` INTEGER NOT NULL,
    `canal` VARCHAR(191) NOT NULL,
    `formato` VARCHAR(191) NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `nota` TEXT NULL,
    `creadoPorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingPost_mes_idx`(`mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

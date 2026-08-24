-- Marketing (22/08): vínculo publicación del calendario ↔ archivo subido
-- (sello «usado»). SOLO CREATE TABLE — no toca nada existente.
CREATE TABLE `MarketingPostArchivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `postId` INTEGER NOT NULL,
    `archivoId` INTEGER NOT NULL,

    UNIQUE INDEX `MarketingPostArchivo_postId_archivoId_key`(`postId`, `archivoId`),
    INDEX `MarketingPostArchivo_archivoId_idx`(`archivoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MarketingPostArchivo` ADD CONSTRAINT `MarketingPostArchivo_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `MarketingPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MarketingPostArchivo` ADD CONSTRAINT `MarketingPostArchivo_archivoId_fkey` FOREIGN KEY (`archivoId`) REFERENCES `Archivo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

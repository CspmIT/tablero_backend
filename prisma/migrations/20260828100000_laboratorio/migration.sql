-- Laboratorio (28/08): administración de servidores InfluxDB/MQTT y cola de
-- solicitudes de borrado de datos en InfluxDB (migradas desde la Oficina
-- Virtual). SOLO CREATE TABLE — aditiva, no toca nada existente.
CREATE TABLE `LabServidor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(20) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `usuario` VARCHAR(191) NULL,
    `contrasena` VARCHAR(500) NULL,
    `puerto` INTEGER NULL,
    `buckets` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LabBorrado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `servidorMqttId` INTEGER NULL,
    `servidorNombre` VARCHAR(191) NULL,
    `servidorInfluxId` INTEGER NULL,
    `servidorInfluxNombre` VARCHAR(191) NULL,
    `bucket` VARCHAR(191) NOT NULL,
    `topico` VARCHAR(500) NOT NULL,
    `desde` DATETIME(3) NOT NULL,
    `hasta` DATETIME(3) NOT NULL,
    `estado` VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    `resultado` TEXT NULL,
    `solicitadoPorId` INTEGER NULL,
    `solicitadoPor` VARCHAR(191) NULL,
    `ejecutadoAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `LabBorrado_estado_idx`(`estado`),
    INDEX `LabBorrado_createdAt_idx`(`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

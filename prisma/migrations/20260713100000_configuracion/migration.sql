-- Tabla de configuración editable desde la app (valores cifrados en reposo).
CREATE TABLE `Configuracion` (
  `clave` VARCHAR(191) NOT NULL,
  `valor` TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`clave`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

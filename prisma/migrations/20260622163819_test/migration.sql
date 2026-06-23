-- CreateTable
CREATE TABLE `Colaborador` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `identitySub` VARCHAR(191) NULL,
    `tipo` ENUM('manager', 'gerencial', 'collaborator', 'externo', 'tercerizado') NOT NULL DEFAULT 'collaborator',
    `nombre` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `sector` VARCHAR(191) NULL,
    `funcionCosto` VARCHAR(191) NOT NULL DEFAULT 'desarrollo',
    `iniciales` VARCHAR(191) NULL,
    `foto` TEXT NULL,
    `haceGuardia` BOOLEAN NOT NULL DEFAULT false,
    `fechaIngreso` DATE NULL,
    `fechaSalida` DATE NULL,
    `cumpleDia` INTEGER NULL,
    `cumpleMes` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Colaborador_identitySub_key`(`identitySub`),
    INDEX `Colaborador_activo_idx`(`activo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ColaboradorPeriodo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `colaboradorId` INTEGER NOT NULL,
    `desde` DATE NOT NULL,
    `hasta` DATE NULL,

    INDEX `ColaboradorPeriodo_colaboradorId_idx`(`colaboradorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Proyecto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `enfoque` ENUM('ORGANIZACION', 'ELECTRONICA', 'DESARROLLO_WEB', 'COMERCIALIZACION', 'OPERACION') NULL,
    `estado` ENUM('activo', 'pausado', 'cerrado') NOT NULL DEFAULT 'activo',
    `cliente` VARCHAR(191) NULL,
    `descripcion` TEXT NULL,
    `ownerId` INTEGER NULL,
    `fechaInicio` DATE NULL,
    `fechaFin` DATE NULL,
    `inicioReal` DATE NULL,
    `cierreReal` DATE NULL,
    `objetivoId` INTEGER NULL,
    `leadId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Proyecto_leadId_idx`(`leadId`),
    INDEX `Proyecto_objetivoId_idx`(`objetivoId`),
    INDEX `Proyecto_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tarea` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proyectoId` INTEGER NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `descripcion` TEXT NULL,
    `kanbanCol` ENUM('backlog', 'todo', 'doing', 'done') NOT NULL DEFAULT 'backlog',
    `prioridad` ENUM('baja', 'media', 'alta', 'urgente') NOT NULL DEFAULT 'media',
    `pct` INTEGER NULL,
    `weight` INTEGER NOT NULL DEFAULT 1,
    `fechaInicio` DATE NULL,
    `fechaFin` DATE NULL,
    `startedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `unidades` JSON NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Tarea_proyectoId_idx`(`proyectoId`),
    INDEX `Tarea_kanbanCol_idx`(`kanbanCol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Plantilla` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `producto` VARCHAR(191) NOT NULL,
    `unidadLabel` VARCHAR(191) NOT NULL DEFAULT 'unidad',
    `etapas` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Plantilla_producto_key`(`producto`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `categoria` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,

    UNIQUE INDEX `Tag_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TareaResponsable` (
    `tareaId` INTEGER NOT NULL,
    `colaboradorId` INTEGER NOT NULL,

    INDEX `TareaResponsable_colaboradorId_idx`(`colaboradorId`),
    PRIMARY KEY (`tareaId`, `colaboradorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TareaTag` (
    `tareaId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,

    INDEX `TareaTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`tareaId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Objetivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(191) NOT NULL,
    `titulo` TEXT NOT NULL,
    `descripcion` TEXT NULL,
    `indicador` TEXT NULL,
    `meta` TEXT NULL,
    `peso` DECIMAL(6, 2) NULL,
    `fechaEsperada` DATE NULL,
    `anio` INTEGER NOT NULL DEFAULT 2026,
    `enfoque` ENUM('ORGANIZACION', 'ELECTRONICA', 'DESARROLLO_WEB', 'COMERCIALIZACION', 'OPERACION') NULL,
    `calculo` ENUM('manual', 'por_tags', 'por_actividad', 'por_leads', 'por_monto_ganado') NOT NULL DEFAULT 'manual',
    `avanceManual` DECIMAL(5, 4) NULL,
    `asignadosIds` JSON NULL,
    `asignadosExternos` JSON NULL,
    `asignadosTodos` BOOLEAN NOT NULL DEFAULT false,
    `depIt` BOOLEAN NOT NULL DEFAULT false,
    `comentarios` TEXT NULL,
    `metaNumerica` DECIMAL(14, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Objetivo_codigo_key`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ObjetivoTag` (
    `objetivoId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,

    INDEX `ObjetivoTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`objetivoId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ObjetivoAporteActividad` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `objetivoId` INTEGER NOT NULL,
    `tipo` ENUM('visita', 'videollamada', 'evento') NOT NULL,
    `aportePct` DECIMAL(6, 2) NOT NULL,

    UNIQUE INDEX `ObjetivoAporteActividad_objetivoId_tipo_key`(`objetivoId`, `tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contactoNombre` VARCHAR(191) NULL,
    `organizacion` VARCHAR(191) NOT NULL,
    `telefono` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `ciudad` VARCHAR(191) NULL,
    `fechaPrimerContacto` DATE NULL,
    `ownerId` INTEGER NULL,
    `etapa` ENUM('contacto', 'visita_agendada', 'visita_realizada', 'propuesta', 'negociacion', 'trial', 'ganado', 'perdido') NOT NULL DEFAULT 'contacto',
    `valorEstimadoUsd` DECIMAL(14, 2) NULL,
    `esEvento` BOOLEAN NOT NULL DEFAULT false,
    `valorOrigen` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `montoFacturadoUsd` DECIMAL(14, 2) NULL,
    `cantidadEquipos` INTEGER NULL,
    `equiposDetalle` TEXT NULL,
    `proximaAccion` VARCHAR(191) NULL,
    `proximaAccionFecha` DATE NULL,
    `motivoPerdido` TEXT NULL,
    `notas` TEXT NULL,
    `fuente` VARCHAR(191) NULL,
    `fuenteOtra` VARCHAR(191) NULL,
    `trialVence` DATE NULL,
    `trialNotas` TEXT NULL,
    `presupuestoEnviadoFecha` DATE NULL,
    `presupuestoAprobadoFecha` DATE NULL,
    `presupuestoLink` VARCHAR(191) NULL,
    `presupuestoEstado` JSON NULL,
    `presupuestoAguaEstado` JSON NULL,
    `coopcloudEstado` JSON NULL,
    `coopcloudCostoMensual` DECIMAL(14, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Lead_etapa_idx`(`etapa`),
    INDEX `Lead_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadProducto` (
    `leadId` INTEGER NOT NULL,
    `producto` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`leadId`, `producto`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cliente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `tipoCliente` VARCHAR(191) NULL DEFAULT 'Cooperativa',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Cliente_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CrmActividad` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NULL,
    `colaboradorId` INTEGER NULL,
    `tipo` ENUM('visita', 'videollamada', 'evento') NOT NULL,
    `fecha` DATE NOT NULL,
    `notas` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CrmActividad_leadId_idx`(`leadId`),
    INDEX `CrmActividad_tipo_fecha_idx`(`tipo`, `fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Archivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(191) NULL,
    `tamano` INTEGER NULL,
    `gpsLat` DOUBLE NULL,
    `gpsLng` DOUBLE NULL,
    `esBoceto` BOOLEAN NOT NULL DEFAULT false,
    `leadId` INTEGER NULL,
    `objetivoId` INTEGER NULL,
    `contexto` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Archivo_key_key`(`key`),
    INDEX `Archivo_leadId_idx`(`leadId`),
    INDEX `Archivo_objetivoId_idx`(`objetivoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GrillaEntrada` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `colaboradorId` INTEGER NOT NULL,
    `fecha` DATE NOT NULL,
    `estado` ENUM('present', 'home_office', 'vacaciones', 'franco', 'franco_cumple', 'feriado', 'licencia', 'viaje') NOT NULL DEFAULT 'present',
    `entryTime` VARCHAR(191) NULL,
    `viajeLabel` VARCHAR(191) NULL,
    `items` JSON NULL,
    `horasExtra` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GrillaEntrada_fecha_idx`(`fecha`),
    UNIQUE INDEX `GrillaEntrada_colaboradorId_fecha_key`(`colaboradorId`, `fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WeeklyWip` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `colaboradorId` INTEGER NOT NULL,
    `anio` INTEGER NOT NULL,
    `semanaIso` INTEGER NOT NULL,
    `texto` TEXT NOT NULL,

    UNIQUE INDEX `WeeklyWip_colaboradorId_anio_semanaIso_key`(`colaboradorId`, `anio`, `semanaIso`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuardiaSemana` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `anio` INTEGER NOT NULL,
    `week` INTEGER NOT NULL,
    `range` VARCHAR(191) NOT NULL,
    `asignaciones` JSON NOT NULL,

    UNIQUE INDEX `GuardiaSemana_anio_week_key`(`anio`, `week`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FrancoEspecial` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `colaboradorId` INTEGER NOT NULL,
    `fecha` DATE NOT NULL,
    `tipo` VARCHAR(191) NULL,
    `motivo` VARCHAR(191) NULL,

    INDEX `FrancoEspecial_colaboradorId_idx`(`colaboradorId`),
    INDEX `FrancoEspecial_fecha_idx`(`fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feriado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fecha` DATE NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Feriado_fecha_key`(`fecha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Carryover` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `colaboradorId` INTEGER NOT NULL,
    `anio` INTEGER NOT NULL,
    `dias` DECIMAL(6, 2) NOT NULL,

    UNIQUE INDEX `Carryover_colaboradorId_anio_key`(`colaboradorId`, `anio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CostoMensual` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mes` VARCHAR(191) NOT NULL,
    `costoLaboral` DECIMAL(14, 2) NULL,
    `cotizacionDolar` DECIMAL(14, 4) NULL,
    `asignaciones` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CostoMensual_mes_key`(`mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ColaboradorPeriodo` ADD CONSTRAINT `ColaboradorPeriodo_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Proyecto` ADD CONSTRAINT `Proyecto_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Colaborador`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Proyecto` ADD CONSTRAINT `Proyecto_objetivoId_fkey` FOREIGN KEY (`objetivoId`) REFERENCES `Objetivo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Proyecto` ADD CONSTRAINT `Proyecto_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tarea` ADD CONSTRAINT `Tarea_proyectoId_fkey` FOREIGN KEY (`proyectoId`) REFERENCES `Proyecto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TareaResponsable` ADD CONSTRAINT `TareaResponsable_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TareaResponsable` ADD CONSTRAINT `TareaResponsable_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TareaTag` ADD CONSTRAINT `TareaTag_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TareaTag` ADD CONSTRAINT `TareaTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ObjetivoTag` ADD CONSTRAINT `ObjetivoTag_objetivoId_fkey` FOREIGN KEY (`objetivoId`) REFERENCES `Objetivo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ObjetivoTag` ADD CONSTRAINT `ObjetivoTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ObjetivoAporteActividad` ADD CONSTRAINT `ObjetivoAporteActividad_objetivoId_fkey` FOREIGN KEY (`objetivoId`) REFERENCES `Objetivo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Colaborador`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadProducto` ADD CONSTRAINT `LeadProducto_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrmActividad` ADD CONSTRAINT `CrmActividad_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CrmActividad` ADD CONSTRAINT `CrmActividad_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Archivo` ADD CONSTRAINT `Archivo_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Archivo` ADD CONSTRAINT `Archivo_objetivoId_fkey` FOREIGN KEY (`objetivoId`) REFERENCES `Objetivo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrillaEntrada` ADD CONSTRAINT `GrillaEntrada_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WeeklyWip` ADD CONSTRAINT `WeeklyWip_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FrancoEspecial` ADD CONSTRAINT `FrancoEspecial_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Carryover` ADD CONSTRAINT `Carryover_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

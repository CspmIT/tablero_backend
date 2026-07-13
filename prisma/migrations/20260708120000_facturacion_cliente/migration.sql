-- Datos de facturación en Cliente (pedido Carola 07/07). Columnas opcionales;
-- la obligatoriedad al pasar a "Ganado" la impone la UI del hand-off.
ALTER TABLE `Cliente`
  ADD COLUMN `razonSocial` VARCHAR(191) NULL,
  ADD COLUMN `cuit` VARCHAR(191) NULL,
  ADD COLUMN `direccion` VARCHAR(191) NULL,
  ADD COLUMN `localidad` VARCHAR(191) NULL,
  ADD COLUMN `ciudad` VARCHAR(191) NULL,
  ADD COLUMN `celular` VARCHAR(191) NULL,
  ADD COLUMN `emailFacturacion` VARCHAR(191) NULL;

-- Vínculo opcional Lead → Cliente (se fija al cargar facturación o al ganar).
ALTER TABLE `Lead` ADD COLUMN `clienteId` INTEGER NULL;

CREATE INDEX `Lead_clienteId_idx` ON `Lead`(`clienteId`);

ALTER TABLE `Lead` ADD CONSTRAINT `Lead_clienteId_fkey`
  FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

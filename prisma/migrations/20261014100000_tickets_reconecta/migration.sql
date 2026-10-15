-- Tickets desde Reconecta (14/10): una cooperativa abre el ticket en Reconecta
-- y entra al Inbox por la API key de routes/integracionReconecta.js.
-- ADITIVA: suma un valor al enum de origen y la columna de la cooperativa.
ALTER TABLE `Ticket` MODIFY `origen` ENUM('manual','whatsapp','mesa_ayuda','reconecta') NOT NULL DEFAULT 'manual';

ALTER TABLE `Ticket` ADD COLUMN `cooperativa` VARCHAR(191) NULL,
    ADD COLUMN `cooperativaNombre` VARCHAR(191) NULL;

CREATE INDEX `Ticket_cooperativa_idx` ON `Ticket`(`cooperativa`);

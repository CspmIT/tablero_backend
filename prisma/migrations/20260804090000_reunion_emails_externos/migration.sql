-- Invitados externos por mail (pedido de Carola 04/08): varios mails del lado
-- del cliente aunque el lead tenga uno solo. Aditiva: solo ADD COLUMN.
ALTER TABLE `Reunion` ADD COLUMN `emailsExternos` JSON NULL;

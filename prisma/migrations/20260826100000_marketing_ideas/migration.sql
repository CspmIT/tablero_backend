-- Marketing (26/08): bandeja de Ideas + tilde de aprobación.
-- ADITIVA Y NO DESTRUCTIVA: agrega una columna con default y relaja `dia` a
-- NULL (ningún dato existente cambia; NULL pasa a significar "idea sin fecha").
ALTER TABLE `MarketingPost` ADD COLUMN `aprobada` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `MarketingPost` MODIFY `dia` INTEGER NULL;

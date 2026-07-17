-- Tags en la reunión: el ítem de grilla nace etiquetado y las etiquetas
-- sobreviven a las reprogramaciones (viajan con la Reunion, no con el ítem).
ALTER TABLE `Reunion` ADD COLUMN `tags` JSON NULL;

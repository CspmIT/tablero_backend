-- Etapa "declinado" (06/08): faltaba en el ENUM y el guardado daba 500.
-- Aditiva: agrega el valor al final, los datos existentes no se tocan.
ALTER TABLE `Lead` MODIFY `etapa` ENUM('contacto', 'visita_agendada', 'visita_realizada', 'propuesta', 'negociacion', 'trial', 'ganado', 'perdido', 'declinado') NOT NULL DEFAULT 'contacto';

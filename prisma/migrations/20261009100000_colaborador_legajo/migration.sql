-- Legajo de RRHH del colaborador (09/10, pedido de Leonardo): campo OPCIONAL
-- de la ficha de Equipo — lo usa el export de guardias al importador de RRHH.
-- Aditiva: solo agrega una columna nullable, no toca datos existentes.
ALTER TABLE `Colaborador` ADD COLUMN `legajo` VARCHAR(20) NULL;

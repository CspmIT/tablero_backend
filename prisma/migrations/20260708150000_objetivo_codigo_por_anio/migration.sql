-- Objetivos: el código pasa de único global a único POR AÑO (pedido 08/07).
-- Permite cargar "OE01" en 2025, 2026 y 2027 como objetivos distintos.
-- El usuario sigue viendo y cargando el código de siempre; el año es otro campo.
DROP INDEX `Objetivo_codigo_key` ON `Objetivo`;

CREATE UNIQUE INDEX `Objetivo_codigo_anio_key` ON `Objetivo`(`codigo`, `anio`);

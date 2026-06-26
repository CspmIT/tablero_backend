-- Credencial de login estilo Reconecta (token_app): UUID único por usuario.
ALTER TABLE `Colaborador` ADD COLUMN `tokenApp` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Colaborador_tokenApp_key` ON `Colaborador`(`tokenApp`);

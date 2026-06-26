import { PrismaClient } from '@prisma/client';

// Cliente único de base de datos para toda la app.
// `omit` global: `tokenApp` es una credencial y NUNCA debe salir en respuestas.
// Queda excluida de todas las queries por defecto; el login la lee puntualmente
// con `omit: { tokenApp: false }`.
export const prisma = new PrismaClient({
  omit: { colaborador: { tokenApp: true } },
});

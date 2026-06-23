import { PrismaClient } from '@prisma/client';

// Cliente único de base de datos para toda la app.
export const prisma = new PrismaClient();

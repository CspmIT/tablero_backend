import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Los usuarios del equipo (con su token_app) se cargan con un seeder aparte:
  //   npm run db:seed:usuarios   (ver prisma/seedUsuarios.js)
  // Este seed sólo deja datos de referencia comunes.

  // Algunas etiquetas de ejemplo
  const tags = ['Urgente', 'Cliente', 'Interno', 'Marca'];
  for (const nombre of tags) {
    await prisma.tag.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  console.log('Seed completo.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

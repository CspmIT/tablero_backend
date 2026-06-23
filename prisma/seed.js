import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Colaborador inicial (vos): queda con id 1, que es el usuario por defecto en modo dev.
  const count = await prisma.colaborador.count();
  if (count === 0) {
    await prisma.colaborador.create({
      data: {
        nombre: 'Leonardo Depetris',
        tipo: 'manager',
        email: 'leonardo@coopmorteros.coop',
        iniciales: 'LD',
        haceGuardia: false,
        activo: true,
        identitySub: null, // se completará cuando conectemos el login real
      },
    });
    console.log('Colaborador inicial creado (id 1).');
  }

  // Algunas etiquetas de ejemplo
  const tags = ['Urgente', 'Cliente', 'Interno', 'Marca'];
  for (const nombre of tags) {
    await prisma.tag.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  console.log('Seed completo.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

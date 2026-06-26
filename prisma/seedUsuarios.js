import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
//  Seeder de usuarios del tablero con su token_app (credencial de login estilo
//  Reconecta). Pensado para migrar el equipo al servidor de prod.
//
//  Ejecutar:  npm run db:seed:usuarios
//
//  Idempotente: busca por email y crea o actualiza el tokenApp (no duplica).
//
//  NOTA: `tipo` es la clasificación PROPIA del tablero (manager | gerencial |
//  collaborator | externo | tercerizado), NO es el `profile` de Cooptech.
//  Ajustá el rol de cada uno si corresponde.
// ---------------------------------------------------------------------------

const USUARIOS = [
  {
    nombre: 'Juan Gonzalez',
    email: 'fgonzalez@coopmorteros.coop',
    tipo: 'manager',
    iniciales: 'JG',
    tokenApp: 'f5cd3c90-b94c-11ef-9315-17dc438c9123',
  },
  {
    nombre: 'Leonardo Depetris',
    email: 'ldepetris@coopmorteros.coop',
    tipo: 'manager',
    iniciales: 'LD',
    tokenApp: '33172770-d34a-11ef-b611-e55b66446d87',
  },
];

async function main() {
  for (const u of USUARIOS) {
    const existe = await prisma.colaborador.findFirst({ where: { email: u.email } });
    if (existe) {
      await prisma.colaborador.update({
        where: { id: existe.id },
        data: { nombre: u.nombre, tipo: u.tipo, iniciales: u.iniciales, tokenApp: u.tokenApp, activo: true },
      });
      console.log(`Actualizado: ${u.email} (id ${existe.id})`);
    } else {
      const c = await prisma.colaborador.create({ data: { ...u, activo: true } });
      console.log(`Creado: ${u.email} (id ${c.id})`);
    }
  }
  console.log('Seed de usuarios completo.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

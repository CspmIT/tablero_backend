import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getConfig, setConfig } from '../src/lib/config.js';

// ---------------------------------------------------------------------------
//  Otorga la solapa «Organizaciones» (administración de clientes de Cooptech y
//  sus usuarios) a las personas que la tienen que ver.
//
//  Esa solapa está declarada con `roles: []` en el nav del frontend: ningún rol
//  la da por defecto, se otorga de a una persona desde
//  Configuración → Permisos. Este seeder deja sembrado el estado inicial para
//  no tener que hacerlo a mano en cada ambiente.
//
//  Ejecutar:  npm run db:seed:permisos
//
//  Idempotente y aditivo: respeta los permisos que ya tenga cada persona y no
//  toca a nadie que no esté en la lista.
// ---------------------------------------------------------------------------

const SOLAPA = 'organizaciones';
const CLAVE = 'ui_permisos';

// Quiénes arrancan con la solapa otorgada. Se busca por email para que sirva
// igual en desarrollo y en producción, donde los ids no coinciden.
const EMAILS = [
  'ldepetris@coopmorteros.coop',
  'fgonzalez@coopmorteros.coop',
];

const prisma = new PrismaClient();

async function main() {
  const raw = await getConfig(CLAVE);
  let overrides = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') overrides = parsed;
  } catch {
    console.warn('Los permisos guardados no se pudieron leer; se parte de cero.');
  }

  let cambios = 0;
  for (const email of EMAILS) {
    const colaborador = await prisma.colaborador.findFirst({ where: { email } });
    if (!colaborador) {
      console.warn(`- ${email}: no existe en este ambiente, se saltea.`);
      continue;
    }
    const clave = String(colaborador.id);
    const actual = overrides[clave] || {};
    const extra = Array.isArray(actual.extra) ? [...actual.extra] : [];
    const ocultas = Array.isArray(actual.ocultas) ? [...actual.ocultas] : [];

    if (extra.includes(SOLAPA) && !ocultas.includes(SOLAPA)) {
      console.log(`- ${colaborador.nombre}: ya la tenía otorgada.`);
      continue;
    }
    if (!extra.includes(SOLAPA)) extra.push(SOLAPA);
    // Si alguien se la ocultó explícitamente, se respeta la decisión.
    if (ocultas.includes(SOLAPA)) {
      console.log(`- ${colaborador.nombre}: la tiene ocultada a propósito, no se toca.`);
      continue;
    }
    overrides[clave] = { extra, ocultas };
    cambios++;
    console.log(`- ${colaborador.nombre}: otorgada.`);
  }

  if (cambios) {
    await setConfig(CLAVE, JSON.stringify(overrides));
    console.log(`\nListo: ${cambios} cambio(s) guardado(s).`);
  } else {
    console.log('\nNo hubo cambios que guardar.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

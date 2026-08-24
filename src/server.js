import 'dotenv/config';
import { createApp } from './app.js';
import { iniciarSyncPeriodico } from './lib/mesaAyudaSync.js';

const PORT = Number(process.env.PORT || 4000);

async function main() {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`\n  API Tablero Cooptech escuchando en http://localhost:${PORT}`);
    console.log(`  Documentación:  http://localhost:${PORT}/api-docs`);
    console.log(`  Salud:          http://localhost:${PORT}/health\n`);
  });
  // Conector Mesa de ayuda (24/08): cada 5 min si está configurado; si no, silencio.
  iniciarSyncPeriodico();
}

main().catch((e) => { console.error('No se pudo arrancar:', e); process.exit(1); });

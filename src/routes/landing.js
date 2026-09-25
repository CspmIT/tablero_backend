import { Router } from 'express';
import { Readable } from 'node:stream';
import { prisma } from '../lib/prisma.js';
import { getConfig } from '../lib/config.js';
import { descargarBinario, almacenamientoConfigurado } from '../lib/almacenamiento.js';

// ---------------------------------------------------------------------------
// API PÚBLICA para la landing de Cooptech (25/09). SIN login ni token, decisión
// de Leonardo: la web la consulta desde el navegador del visitante (un token
// quedaría expuesto en el código de la página) y todo lo que expone ya es
// público en la web. Solo dos cosas salen por acá:
//
//   1. Los 6 precios monómicos PUBLICADOS a propósito — nunca el simulador en
//      vivo: el simulador global es herramienta de trabajo y un experimento
//      guardado no debe cambiar los precios públicos. Publicar es el botón
//      «Publicar precios en la web» del simulador (manager/gerencial), que
//      guarda la foto en la clave `landing_monomicos` de Configuracion.
//   2. Los logos de la carpeta Marketing → Marca → Logos → «Logos Clientes»
//      (solo ESA carpeta; solo imágenes). El binario vive en el gateway de
//      almacenamiento que exige credenciales, así que se sirve desde acá.
//
// Montado en app.js ANTES de authenticate (patrón multivacPublico). CORS ya es
// abierto a nivel app (app.use(cors())), necesario porque la web es otro origen.
// ---------------------------------------------------------------------------

const router = Router();

const MON_CLAVES = ['vcpu', 'ram', 'ssd', 'hdd', 'ip', 'mbps'];

// Ruta lógica (campo `url` de Archivo) de la carpeta que se expone, comparada
// insensible a mayúsculas. Si la carpeta se renombra en Marketing, esto deja
// de listar — a propósito: exponer archivos es opt-in por ESTA ruta puntual.
const CARPETA_LOGOS = 'marca/logos/logos clientes';

// Solo imágenes (la carpeta admite otros formatos; un zip no es un logo).
const esImagen = (a) =>
  (a.mime && a.mime.toLowerCase().startsWith('image/')) ||
  /\.(png|jpe?g|gif|webp|svg)$/i.test(String(a.nombre || a.key));

const enCarpetaLogos = (a) => String(a.url || '').trim().toLowerCase() === CARPETA_LOGOS;

// Base pública para armar URLs absolutas de los logos: LANDING_BASE_URL si
// está seteada; si no, lo que declara el request (detrás del proxy llega el
// host público por Host / X-Forwarded-*).
function baseDe(req) {
  const env = (process.env.LANDING_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

// Los 6 precios unitarios en USD sin IVA, tal como se publicaron desde el
// simulador. El contrato con la web: SOLO estas claves, números planos.
//   { "vcpu": 1.1915, "ram": 3.2005, "ssd": 0.0548,
//     "hdd": 0.0449, "ip": 1.7987, "mbps": 0.0191 }
// Sin publicación todavía → 404 (la web cae a sus valores por defecto).
router.get('/landing/monomicos', async (req, res, next) => {
  try {
    const raw = await getConfig('landing_monomicos');
    let pub = null;
    if (raw) { try { pub = JSON.parse(raw); } catch { pub = null; } }
    if (!pub || typeof pub !== 'object') {
      return res.status(404).json({ error: 'sin_publicar', message: 'Todavía no se publicaron precios desde el tablero' });
    }
    const out = {};
    for (const k of MON_CLAVES) out[k] = Number(pub[k]) || 0;
    res.set('Cache-Control', 'public, max-age=300');
    res.json(out);
  } catch (e) { next(e); }
});

// Casos de éxito: [{ nombre, logo }] envuelto en { clientes } (formas que la
// web acepta). `nombre` = nombre del archivo sin extensión — renombrar el
// archivo en Marketing es renombrar el cliente en la web.
router.get('/landing/clientes', async (req, res, next) => {
  try {
    const data = await prisma.archivo.findMany({
      where: { contexto: 'marketing' },
      orderBy: { nombre: 'asc' },
    });
    const base = baseDe(req);
    const clientes = data
      .filter((a) => enCarpetaLogos(a) && esImagen(a))
      .map((a) => ({
        nombre: String(a.nombre || a.key).replace(/\.[a-z0-9]+$/i, '').trim(),
        logo: `${base}/api/landing/clientes/logos/${encodeURIComponent(a.key)}`,
      }));
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ clientes });
  } catch (e) { next(e); }
});

// El binario de UN logo. Solo sirve keys registradas EN ESA carpeta — nada más
// del bucket sale por acá (el gateway exige credenciales, que viven en el
// servidor; el navegador del visitante no podría leerlo directo).
router.get('/landing/clientes/logos/:key', async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    const a = key ? await prisma.archivo.findUnique({ where: { key } }) : null;
    if (!a || a.contexto !== 'marketing' || !enCarpetaLogos(a) || !esImagen(a)) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (!almacenamientoConfigurado()) {
      return res.status(503).json({ error: 'almacenamiento_no_configurado', message: 'Faltan credenciales del almacenamiento en el servidor' });
    }
    const r = await descargarBinario(key);
    if (!r || !r.ok) {
      return res.status(502).json({ error: 'gateway', message: 'No se pudo leer el logo del almacenamiento' });
    }
    res.set('Content-Type', a.mime || r.headers.get('content-type') || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) { next(e); }
});

export default router;

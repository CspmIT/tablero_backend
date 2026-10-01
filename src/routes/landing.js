import { Router } from 'express';
import { Readable } from 'node:stream';
import { prisma } from '../lib/prisma.js';
import { getConfig } from '../lib/config.js';
import { descargarBinario, almacenamientoConfigurado } from '../lib/almacenamiento.js';
import { notificarSuscriptosA } from '../lib/push.js';

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

// ---------------------------------------------------------------------------
// 28/09 — Módulo Marketing → Landing: la web pasa a hacer UN solo fetch
// (GET /api/landing) con todo lo PUBLICADO (tabla LandingVersion; el borrador
// nunca sale por acá). Las URLs de archivos viajan congeladas RELATIVAS en el
// payload y se absolutizan por request; los binarios salen SOLO si su key
// está en la whitelist de la última versión publicada.
// ---------------------------------------------------------------------------

// Caché en memoria de la última versión parseada (se refresca cuando cambia
// el id — una query liviana por request, el JSON.parse solo al publicar).
let cacheVersion = { id: 0, payload: null, keys: new Set() };
async function versionPublicada() {
  const v = await prisma.landingVersion.findFirst({ orderBy: { numero: 'desc' }, select: { id: true, numero: true } }).catch(() => null);
  if (!v) return null;
  if (v.id !== cacheVersion.id) {
    const fila = await prisma.landingVersion.findUnique({ where: { id: v.id } });
    let payload = null;
    try { payload = JSON.parse(fila.payload); } catch { payload = null; }
    cacheVersion = { id: v.id, numero: v.numero, payload, keys: new Set(payload?.archivos || []) };
  }
  return cacheVersion.payload ? cacheVersion : null;
}

// Absolutiza las URLs relativas /api/landing/... del payload congelado.
function absolutizar(valor, base) {
  if (typeof valor === 'string') return valor.startsWith('/api/landing/') ? base + valor : valor;
  if (Array.isArray(valor)) return valor.map((x) => absolutizar(x, base));
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(valor)) out[k] = absolutizar(v, base);
    return out;
  }
  return valor;
}

// GET /api/landing — todo lo publicado, en un solo JSON (contrato del spec).
// Los monómicos NO se congelan acá: se leen en vivo de la clave que publica
// el botón del simulador («Publicar precios en la web») — un solo dueño.
router.get('/landing', async (req, res, next) => {
  try {
    const v = await versionPublicada();
    if (!v) return res.status(404).json({ error: 'sin_publicar', message: 'Todavía no se publicó la landing desde el tablero' });
    const base = baseDe(req);
    const { archivos, fuente, ...publico } = v.payload; // internos: whitelist y borrador de origen
    let monomicos = null;
    try {
      const raw = await getConfig('landing_monomicos');
      if (raw) { const m = JSON.parse(raw); monomicos = {}; for (const k of MON_CLAVES) monomicos[k] = Number(m[k]) || 0; }
    } catch { monomicos = null; }
    res.set('Cache-Control', 'public, max-age=300');
    const abs = absolutizar(publico, base);
    // entrevistas (28/09 bis): una versión publicada ANTES de que existiera la
    // sección no trae la clave — para la web siempre viaja, aunque vacía.
    res.json({ version: v.numero, ...abs, entrevistas: abs.entrevistas || [], reconocimientos: abs.reconocimientos || [], contacto: abs.contacto || {}, textos: abs.textos || {}, monomicos });
  } catch (e) { next(e); }
});

// GET /api/landing/archivos/:key — el binario de UN archivo publicado.
// Whitelist estricta: solo keys referenciadas por la ÚLTIMA versión.
router.get('/landing/archivos/:key', async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    const v = await versionPublicada();
    if (!v || !v.keys.has(key)) return res.status(404).json({ error: 'not_found' });
    if (!almacenamientoConfigurado()) return res.status(503).json({ error: 'almacenamiento_no_configurado' });
    const r = await descargarBinario(key);
    if (!r || !r.ok) return res.status(502).json({ error: 'gateway', message: 'No se pudo leer el archivo del almacenamiento' });
    const fila = await prisma.archivo.findUnique({ where: { key } }).catch(() => null);
    res.set('Content-Type', fila?.mime || r.headers.get('content-type') || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) { next(e); }
});

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
    // 28/09 (decisión Leonardo, principio «nada se publica solo»): publicada
    // la primera versión desde Marketing → Landing, este endpoint sirve la
    // lista CURADA de esa versión. Mientras no haya publicación, sigue
    // listando la carpeta como siempre (la web no se rompe en el medio).
    const v = await versionPublicada();
    if (v && Array.isArray(v.payload?.clientes)) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json({ clientes: absolutizar(v.payload.clientes, baseDe(req)) });
    }
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

// ---------------------------------------------------------------------------
// POST /api/landing/consultas (28/09): la landing como BOCA DE ENTRADA de
// leads — «Consultar por esta configuración» (CoopCloud), reconectadores
// (Reconecta), plantas (+Agua) o contacto general. Es el ÚNICO endpoint
// público de ESCRITURA del tablero, así que va blindado:
//   · honeypot: el campo `web` (invisible en la página) debe venir VACÍO —
//     un bot que lo llena recibe un 200 falso y no se guarda nada;
//   · rate limit en memoria: 5 por IP cada 10 min y 60 por hora en total;
//   · validación estricta y tamaños acotados; el detalle técnico viaja como
//     JSON chico (config del simulador / reconectadores / plantas).
// La consulta cae en la bandeja «Consultas web» del CRM (decisión Leonardo:
// nada entra al embudo solo — convertir en lead es un click del equipo) y
// dispara el push opt-out «CRM: consulta web».
// ---------------------------------------------------------------------------

const PRODUCTOS_CONSULTA = ['coopcloud', 'reconecta', 'mas-agua', 'centinela', 'oficina-virtual', 'desarrollos', 'general'];
const rlPorIp = new Map(); // ip -> [timestamps]
let rlGlobal = []; // timestamps
const RL_VENTANA_IP = 10 * 60 * 1000, RL_MAX_IP = 5, RL_VENTANA_GLOBAL = 60 * 60 * 1000, RL_MAX_GLOBAL = 60;

function rateLimitOk(ip) {
  const ahora = Date.now();
  rlGlobal = rlGlobal.filter((t) => ahora - t < RL_VENTANA_GLOBAL);
  if (rlGlobal.length >= RL_MAX_GLOBAL) return false;
  const mios = (rlPorIp.get(ip) || []).filter((t) => ahora - t < RL_VENTANA_IP);
  if (mios.length >= RL_MAX_IP) return false;
  mios.push(ahora); rlPorIp.set(ip, mios); rlGlobal.push(ahora);
  if (rlPorIp.size > 5000) rlPorIp.clear(); // higiene: que el mapa no crezca sin fin
  return true;
}

router.post('/landing/consultas', async (req, res, next) => {
  try {
    const b = req.body || {};
    // Honeypot: respuesta 200 FALSA (no revelar el mecanismo) y nada se guarda.
    if (String(b.web || '').trim() !== '') return res.status(201).json({ ok: true });
    const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim().slice(0, 60);
    if (!rateLimitOk(ip)) return res.status(429).json({ error: 'rate_limit', message: 'Demasiadas consultas seguidas — probá de nuevo en unos minutos' });

    const limpiar = (v, max) => String(v ?? '').trim().slice(0, max);
    const producto = limpiar(b.producto, 40).toLowerCase() || 'general';
    if (!PRODUCTOS_CONSULTA.includes(producto)) return res.status(422).json({ error: 'validation', message: 'Producto desconocido' });
    const organizacion = limpiar(b.organizacion, 190);
    const email = limpiar(b.email, 190);
    const telefono = limpiar(b.telefono, 60);
    if (!organizacion) return res.status(422).json({ error: 'validation', message: 'Falta el nombre de la cooperativa u organización' });
    if (!email && !telefono) return res.status(422).json({ error: 'validation', message: 'Dejanos al menos un email o un teléfono para contactarte' });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(422).json({ error: 'validation', message: 'El email no parece válido' });
    let detalle = null;
    if (b.detalle != null) {
      try {
        const json = JSON.stringify(b.detalle);
        if (json.length > 8000) return res.status(422).json({ error: 'validation', message: 'El detalle es demasiado grande' });
        if (json !== 'null') detalle = json;
      } catch { detalle = null; }
    }
    const c = await prisma.landingConsulta.create({
      data: {
        producto,
        organizacion,
        contacto: limpiar(b.contacto, 190) || null,
        email: email || null,
        telefono: telefono || null,
        localidad: limpiar(b.localidad, 190) || null,
        mensaje: limpiar(b.mensaje, 2000) || null,
        detalle,
        origenUrl: limpiar(b.origenUrl, 300) || null,
        ip: ip || null,
      },
    });
    // Aviso opt-out «CRM: consulta web» (fire-and-forget, jamás rompe el alta).
    notificarSuscriptosA('consulta_web', {
      titulo: '🌐 Consulta web nueva',
      cuerpo: `${organizacion} · ${producto}${localidadDe(c)}`,
      url: '/',
    });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
const localidadDe = (c) => (c.localidad ? ` · ${c.localidad}` : '');

export default router;

// Catálogo de firmwares para OTRAS APLICACIONES del ecosistema (Reconecta).
//
// Por qué existe: el módulo AutonomIA de Reconecta necesita leer los releases
// que ingeniería publica acá, pero sin un usuario humano detrás. El único
// camino que había era /api/auth/loginCooptech con un colaborador de servicio,
// y ese JWT abre TODA la API del tablero (CRM, costos, tickets) para leer un
// catálogo de firmwares. Esto es lo mínimo: una API key de solo lectura que
// devuelve únicamente los releases APROBADOS.
//
// Se monta ANTES del middleware `authenticate` (como publicAuthRouter), así que
// no pasa por el login de la app. La credencial es la API key, nada más. No
// tiene rate limit (ninguna ruta del proyecto lo tiene): riesgo asumido, ver
// INTEGRACION_RECONECTA_AUTONOMIA.md §2.
//
// Variable de entorno:
//   FIRMWARES_API_KEY   una clave, o varias separadas por coma (para rotarlas
//                       sin cortar el servicio: se aceptan todas las de la
//                       lista). Sin la variable, el endpoint responde 503 — no
//                       queda abierto por olvido.
//
// Lo que NO sale de acá: los releases sin aprobar (esos solo los ve el área en
// «Gestión de versiones»), el .zip del proyecto Arduino (`fuente`) y quién
// subió cada release (`subidoPor`).
import crypto from 'crypto';
import { Router } from 'express';
import { getConfig } from '../lib/config.js';
import { ApiError } from '../middleware/errorHandler.js';
import { CLAVE_FIRMWARES, PRODUCTOS_FW } from './multivac.js';

export const catalogoFirmwaresRouter = Router();

const clavesValidas = () =>
  String(process.env.FIRMWARES_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

// Comparación de tiempo constante sobre el digest: con === se puede ir
// adivinando la clave midiendo cuánto tarda la respuesta, y comparando los
// buffers crudos habría que cortar antes por longitud (lo que filtra cuánto
// mide la clave). Hasheando, los dos lados miden siempre 32 bytes.
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const coincide = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// La clave viaja en `x-api-key` o como `Authorization: Bearer <clave>`: las dos
// formas son habituales y el cliente usa la que le quede cómoda.
function exigirApiKey(req, res, next) {
  const permitidas = clavesValidas();
  if (!permitidas.length) {
    return next(new ApiError(503, 'not_configured', 'El catálogo externo de firmwares no está habilitado en este servidor'));
  }
  const header = req.headers.authorization || '';
  const clave = req.headers['x-api-key'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!clave || !permitidas.some((k) => coincide(k, clave))) {
    return next(new ApiError(401, 'unauthorized', 'API key inválida o ausente'));
  }
  next();
}

// Proyección explícita: se copia campo por campo lo que el consumidor necesita
// para flashear. Si mañana el manifiesto suma algo interno, no se filtra solo.
const binPublico = (b) =>
  b?.key
    ? {
        key: String(b.key),
        nombre: b.nombre ?? null,
        tamano: b.tamano ?? null,
        sha256: b.sha256 ?? null,
      }
    : null;

const releasePublico = (f) => ({
  modelo: f.modelo,
  chip: f.chip,
  producto: f.producto,
  version: f.version,
  nombre: f.nombre,
  notas: f.notas,
  aprobado: true,
  fecha: f.fecha ?? null,
  flash: f.flash ?? null,
  segmentos: (Array.isArray(f.segmentos) ? f.segmentos : [])
    .map((sg) => ({ ...binPublico(sg), offset: String(sg?.offset || '') }))
    .filter((sg) => sg.key),
  merged: binPublico(f.merged),
});

// GET /api/catalogo/firmwares[?producto=Reconecta,General]
// Respuesta: { firmwares: [...], generado: <ISO> }
catalogoFirmwaresRouter.get('/firmwares', exigirApiKey, async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_FIRMWARES);
    let lista = [];
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) lista = p;
      } catch {
        /* config corrupta: catálogo vacío, igual que el GET interno */
      }
    }

    // Filtro opcional por producto. OJO con el encoding: en un query string el
    // `+` se decodifica como espacio, así que «+Agua» se pide como %2BAgua.
    const crudos = String(req.query.producto || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const pedidos = crudos.filter((p) => PRODUCTOS_FW.includes(p));
    // Si pidió filtrar y ningún valor es un producto conocido, la respuesta va
    // vacía. Devolver el catálogo entero sería darle MÁS de lo que pidió, y en
    // silencio (justamente lo que pasaría con un `+Agua` mal encodeado).
    if (crudos.length && !pedidos.length) {
      return res.json({ firmwares: [], generado: new Date().toISOString() });
    }

    const firmwares = lista
      .filter((f) => f?.aprobado === true)
      .filter((f) => !pedidos.length || pedidos.includes(f.producto))
      .map(releasePublico);

    res.json({ firmwares, generado: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

export default catalogoFirmwaresRouter;

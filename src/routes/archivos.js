import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { getConfig, setConfig } from '../lib/config.js';
import { ApiError } from '../middleware/errorHandler.js';
import { borrarBinario } from '../lib/almacenamiento.js';

const router = Router();

// ---------------------------------------------------------------------------
// Subcarpetas de Marketing (ola 2, 20/08). SIN migración (mismo patrón que las
// carpetas de Documentación): la lista vive como clave JSON en Configuracion,
// un objeto { "<rutaZona>": ["Subcarpeta", "06.08", ...] }. Cada archivo lleva
// su ruta completa en `url` (p.ej. plan/2026-08/feed/06.08 | marca/logos/Productos).
// Permisos (decisión Leonardo 20/08): TODOS crean subcarpetas al necesitarlas;
// renombrar/borrar (sacar de la lista) es curaduría de manager/gerencial —
// un no-gestor solo puede mandar una lista que CONTENGA todo lo que ya había.
// OJO ORDEN DE RUTAS: estas literales van ANTES de /:id (lección 05/08).
// ---------------------------------------------------------------------------
const CLAVE_MK_CARPETAS = 'marketing_carpetas';
const MAX_SUB_POR_ZONA = 60;

const leerMkCarpetas = async () => {
  const raw = await getConfig(CLAVE_MK_CARPETAS);
  if (!raw) return {};
  try { const p = JSON.parse(raw); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; }
  catch { return {}; }
};

router.get('/marketing-carpetas', async (req, res, next) => {
  try { res.json({ carpetas: await leerMkCarpetas() }); } catch (e) { next(e); }
});

router.put('/marketing-carpetas', async (req, res, next) => {
  try {
    const entrada = req.body?.carpetas;
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      throw new ApiError(400, 'bad_request', 'Se espera { carpetas: { rutaZona: [nombres] } }');
    }
    const limpio = {};
    for (const [zona, subs] of Object.entries(entrada)) {
      const z = String(zona || '').trim().slice(0, 80);
      if (!z || !Array.isArray(subs)) continue;
      const vistas = new Set();
      const lista = subs
        .map((s) => String(s || '').trim().replace(/\//g, '·').slice(0, 60)) // sin "/" (rompería la ruta)
        .filter((s) => { if (!s) return false; const k = s.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; })
        .slice(0, MAX_SUB_POR_ZONA);
      if (lista.length) limpio[z] = lista;
    }
    const esGestor = ['manager', 'gerencial'].includes(req.colaborador?.tipo);
    if (!esGestor) {
      // No-gestor: solo AGREGAR — la lista nueva debe conservar todo lo existente.
      const actual = await leerMkCarpetas();
      for (const [zona, subs] of Object.entries(actual)) {
        const nuevas = (limpio[zona] || []).map((s) => s.toLowerCase());
        for (const s of subs) {
          if (!nuevas.includes(String(s).toLowerCase())) {
            throw new ApiError(403, 'forbidden', 'Renombrar o borrar subcarpetas es de manager/gerencial (crear sí podés)');
          }
        }
      }
    }
    await setConfig(CLAVE_MK_CARPETAS, JSON.stringify(limpio));
    res.json({ carpetas: limpio });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Documento del mes de Planificación (28/09, pedido de Leonardo: «las chicas
// de Booster no se adaptaron del todo — que puedan subir la planificación
// mensual como Word, sin procesar, para revisión/aprobación»). El archivo es
// un Archivo común (ruta `plan/<YYYY-MM>/documento`); acá vive SOLO su estado
// de revisión, como JSON en Configuracion (sin migración, patrón carpetas):
//   { "<archivoId>": { estado: 'pendiente'|'aprobado'|'observado',
//                      por, fecha, obs? } }
// Lee todo el equipo; el estado lo cambia SOLO conducción (manager/gerencial).
// OJO ORDEN DE RUTAS: literales ANTES de /:id (lección 05/08).
// ---------------------------------------------------------------------------
const CLAVE_PLAN_DOC = 'marketing_plan_doc_estados';
const PLAN_DOC_ESTADOS = ['pendiente', 'aprobado', 'observado'];

router.get('/plan-doc-estados', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_PLAN_DOC);
    let estados = {};
    if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === 'object') estados = p; } catch { /* se regenera */ } }
    res.json({ estados });
  } catch (e) { next(e); }
});

router.put('/plan-doc-estados', async (req, res, next) => {
  try {
    if (!['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Aprobar u observar el documento del mes es de conducción');
    }
    const archivoId = Number(req.body?.archivoId);
    const estado = String(req.body?.estado || '').trim();
    if (!archivoId || !PLAN_DOC_ESTADOS.includes(estado)) {
      throw new ApiError(400, 'bad_request', `Se espera { archivoId, estado: ${PLAN_DOC_ESTADOS.join('|')}, obs? }`);
    }
    const raw = await getConfig(CLAVE_PLAN_DOC);
    let estados = {};
    if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === 'object') estados = p; } catch { estados = {}; } }
    if (estado === 'pendiente') {
      delete estados[String(archivoId)]; // pendiente = sin registro (el default)
    } else {
      estados[String(archivoId)] = {
        estado,
        por: req.colaborador?.nombre || null,
        fecha: new Date().toISOString(),
        ...(estado === 'observado' && req.body?.obs ? { obs: String(req.body.obs).trim().slice(0, 500) } : {}),
      };
    }
    // Higiene: si el mapa crece de más (archivos borrados hace tiempo), se
    // recortan las entradas más viejas — el estado de un doc ya borrado no
    // le sirve a nadie.
    const entradas = Object.entries(estados);
    if (entradas.length > 300) {
      entradas.sort((a, b) => String(a[1]?.fecha || '').localeCompare(String(b[1]?.fecha || '')));
      estados = Object.fromEntries(entradas.slice(entradas.length - 300));
    }
    await setConfig(CLAVE_PLAN_DOC, JSON.stringify(estados));
    res.json({ estados });
  } catch (e) { next(e); }
});

// Almacenamiento de archivos:
// El binario lo sube y lo lee directamente el FRONTEND contra el gateway de
// almacenamiento (storageov → MinIO). Acá sólo guardamos la REFERENCIA: el
// `key` (nombre del archivo en el bucket) junto con su metadata y el contexto
// (objetivo / lead) al que pertenece. La imagen se resuelve en el cliente con
// ese `key` mediante getImage().

// Listar referencias, filtrando por objetivo o lead (?objetivoId= / ?leadId=).
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.objetivoId) where.objetivoId = Number(req.query.objetivoId);
    if (req.query.leadId) where.leadId = Number(req.query.leadId);
    if (req.query.contexto) where.contexto = String(req.query.contexto);
    const data = await prisma.archivo.findMany({ where, orderBy: { createdAt: 'asc' } });
    res.json({ data });
  } catch (e) { next(e); }
});

// Registrar la referencia de un archivo que el frontend ya subió al gateway.
// Body (JSON): { key, nombre?, mime?, tamano?, gpsLat?, gpsLng?, esBoceto?,
//                leadId?, objetivoId?, contexto?, url? }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.key) throw new ApiError(422, 'validation', 'Falta "key" (nombre del archivo en el almacenamiento)');
    const archivo = await prisma.archivo.create({
      data: {
        key: String(b.key),
        url: b.url || null,
        nombre: b.nombre || String(b.key),
        mime: b.mime || null,
        tamano: b.tamano != null && b.tamano !== '' ? Number(b.tamano) : null,
        gpsLat: b.gpsLat != null && b.gpsLat !== '' ? Number(b.gpsLat) : null,
        gpsLng: b.gpsLng != null && b.gpsLng !== '' ? Number(b.gpsLng) : null,
        esBoceto: b.esBoceto === true || b.esBoceto === 'true',
        leadId: b.leadId != null && b.leadId !== '' ? Number(b.leadId) : null,
        objetivoId: b.objetivoId != null && b.objetivoId !== '' ? Number(b.objetivoId) : null,
        contexto: b.contexto || null,
      },
    });
    res.status(201).json(archivo);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
    if (!a) throw new ApiError(404, 'not_found', 'Archivo no encontrado');
    res.json(a);
  } catch (e) { next(e); }
});

// Actualización puntual de una referencia (18/08, biblioteca de Documentación
// de AutonomIA): mover un PDF de carpeta (la carpeta viaja en `url`) o
// retitularlo. Solo nombre y url — el binario en MinIO no se toca.
router.patch('/:id', async (req, res, next) => {
  try {
    const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
    if (!a) throw new ApiError(404, 'not_found', 'Archivo no encontrado');
    // En bibliotecas compartidas, ordenar/retitular es curaduría: manager/gerencial.
    // 20/08: mismo criterio para la sección Marketing (todos suben, la conducción cura).
    if (['multivac_doc', 'marketing'].includes(a.contexto) && !['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Solo manager/gerencial organiza la biblioteca compartida');
    }
    const data = {};
    if (req.body?.nombre !== undefined) data.nombre = String(req.body.nombre || '').trim().slice(0, 200) || a.nombre;
    if (req.body?.url !== undefined) data.url = req.body.url ? String(req.body.url).trim().slice(0, 200) : null;
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar (nombre y/o url)');
    const actualizado = await prisma.archivo.update({ where: { id: a.id }, data });
    res.json(actualizado);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
    if (!a) throw new ApiError(404, 'not_found', 'Archivo no encontrado');
    // Documentación compartida de AutonomIA (18/08) y Marketing (20/08): TODOS
    // pueden subir, pero eliminar de la biblioteca queda para manager/gerencial
    // (decisión de Leonardo — punto medio: cualquiera aporta, solo la conducción cura).
    if (['multivac_doc', 'marketing'].includes(a.contexto) && !['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Solo manager/gerencial puede eliminar de la biblioteca compartida');
    }
    // Desde el 21/08 el gateway sí expone borrado (fix de Juan, masters 8), así
    // que se va la referencia Y el binario. No hace falta chequear si otra fila
    // comparte el objeto: Archivo.key es @unique, así que la referencia que se
    // borra es la única que podía apuntar a esa key (si algún día deja de ser
    // única, hay que contar las otras referencias antes de tocar MinIO).
    await prisma.archivo.delete({ where: { id: a.id } });
    // Best effort: si el gateway no responde, la referencia ya se borró (es lo
    // que el usuario pidió) y queda el aviso en el log para limpiar a mano.
    await borrarBinario(a.key);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;

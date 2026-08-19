// Botones Multivac (ola 3, 07/08) — ABM de comandos precargados del terminal
// de Campo → Multivac, COMPARTIDOS por todo el equipo. Patrón idéntico al
// catálogo de productos del CRM: clave JSON en Configuracion (cifrada), SIN
// migración. Cada botón: { nombre, comando, producto } con producto en
// General | +Agua | Reconecta | Centinela.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { getConfig, setConfig } from '../lib/config.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

const CLAVE = 'multivac_botones';
const PRODUCTOS = ['General', '+Agua', 'Reconecta', 'Centinela'];
const MAX_BOTONES = 100;

// Defaults si nunca se guardó nada (los atajos históricos del terminal).
const DEFAULTS = [
  { nombre: 'Ayuda', comando: 'help', producto: 'General' },
  { nombre: 'Login', comando: 'login', producto: 'General' },
  { nombre: 'Estado', comando: 'status', producto: 'General' },
  { nombre: 'Guardar', comando: 'save', producto: 'General' },
];

router.get('/botones', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE);
    let botones = DEFAULTS;
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) botones = p; } catch { /* config corrupta: defaults */ } }
    res.json({ botones, productos: PRODUCTOS });
  } catch (e) { next(e); }
});

router.put('/botones', async (req, res, next) => {
  try {
    const entrada = req.body?.botones;
    if (!Array.isArray(entrada)) throw new ApiError(400, 'bad_request', 'Se espera { botones: [...] }');
    if (entrada.length > MAX_BOTONES) throw new ApiError(400, 'bad_request', `Máximo ${MAX_BOTONES} botones`);
    const botones = entrada
      .map((b) => ({
        nombre: String(b?.nombre || '').trim().slice(0, 60),
        comando: String(b?.comando || '').trim().slice(0, 200),
        producto: PRODUCTOS.includes(b?.producto) ? b.producto : 'General',
      }))
      .filter((b) => b.nombre && b.comando);
    await setConfig(CLAVE, JSON.stringify(botones));
    res.json({ botones });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Recetas de aprovisionamiento COMPARTIDAS (ola B, 10/08) — antes localStorage
// por navegador; ahora patrón del catálogo/botones: clave JSON en Configuracion.
// Las oficiales salen del help real de Lorenzo (Multivac_CLI_comandos_10_08).
// OJO sintaxis por producto: +Agua add_wifi con COMAS, Reconecta con espacios.
// ---------------------------------------------------------------------------
const CLAVE_RECETAS = 'multivac_recetas';
const MAX_RECETAS = 50;

const RECETAS_DEFAULT = [
  {
    nombre: '+Agua — aprovisionamiento base (oficial)',
    producto: '+Agua',
    variables: ['nombre', 'ssid', 'clave'],
    comandos: 'comando\nlogin\ndev_name {{nombre}}\nset_tz -10800\nadd_wifi 1,{{ssid}},{{clave}}\nenable_wifi 1 on\nset_failover on\ninfo\nlogout',
  },
  {
    nombre: 'Reconecta — aprovisionamiento base (oficial)',
    producto: 'Reconecta',
    variables: ['nombre', 'ssid', 'clave', 'perfil_reco', 'sn'],
    comandos: 'comando\nlogin\ndev_name {{nombre}}\nset_tz -10800\nadd_wifi 1 {{ssid}} {{clave}}\nenable_wifi 1 on\nset_failover on\nset_recloser {{perfil_reco}}\nset_sn {{sn}}\ninfo\nlogout',
  },
];

router.get('/recetas', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_RECETAS);
    let recetas = RECETAS_DEFAULT;
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) recetas = p; } catch { /* defaults */ } }
    res.json({ recetas });
  } catch (e) { next(e); }
});

router.put('/recetas', async (req, res, next) => {
  try {
    const entrada = req.body?.recetas;
    if (!Array.isArray(entrada)) throw new ApiError(400, 'bad_request', 'Se espera { recetas: [...] }');
    if (entrada.length > MAX_RECETAS) throw new ApiError(400, 'bad_request', `Máximo ${MAX_RECETAS} recetas`);
    const recetas = entrada
      .map((r) => ({
        nombre: String(r?.nombre || '').trim().slice(0, 120),
        producto: String(r?.producto || '').trim().slice(0, 40),
        variables: Array.isArray(r?.variables) ? r.variables.map((v) => String(v).trim()).filter(Boolean).slice(0, 20) : [],
        comandos: String(r?.comandos || '').slice(0, 8000),
      }))
      .filter((r) => r.nombre && r.comandos);
    await setConfig(CLAVE_RECETAS, JSON.stringify(recetas));
    res.json({ recetas });
  } catch (e) { next(e); }
});

// Plantilla que convierte cada recurso del planteo CriterIA en una línea de la
// secuencia. Variables: {{canal}}, {{descripcion}}, {{tipo}} (AI|BUS).
// Default = comentario (guía visual); cuando Lorenzo defina el JSON de
// add_sensor_json, se cambia ACÁ por la línea real — sin redeploy.
const CLAVE_PLANTILLA = 'multivac_plantilla_sensor';
const PLANTILLA_DEFAULT = '# {{canal}}: {{descripcion}}';

router.get('/plantilla-sensor', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_PLANTILLA);
    res.json({ plantilla: raw || PLANTILLA_DEFAULT });
  } catch (e) { next(e); }
});

router.put('/plantilla-sensor', async (req, res, next) => {
  try {
    const plantilla = String(req.body?.plantilla || '').slice(0, 1000);
    await setConfig(CLAVE_PLANTILLA, plantilla || null);
    res.json({ plantilla: plantilla || PLANTILLA_DEFAULT });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Catálogo de firmwares (ola C, 10/08) — releases versionados para programar
// las placas desde la plataforma (esptool-js). SIN migración: el catálogo es
// una clave JSON en Configuracion; los binarios van a MinIO por el gateway
// (patrón Archivo, contexto 'firmware'). Cada release = manifiesto:
// { modelo, chip, producto, version, nombre, aprobado, notas,
//   flash:{mode,freq,size}, segmentos:[{offset:'0x1000', key, nombre, tamano}],
//   fecha, subidoPor }
// NUNCA erase-all: se escriben SOLO los segmentos del manifiesto (NVS/LittleFS
// y el spool de mediciones quedan intactos — decisión de Lorenzo, 10/08).
// ---------------------------------------------------------------------------
const CLAVE_FIRMWARES = 'multivac_firmwares';
const CHIPS = ['esp32', 'esp32s3', 'esp32c3'];
// Producto (aplicación) que corre el firmware — columna del catálogo (12/08).
const PRODUCTOS_FW = ['General', '+Agua', 'Reconecta', 'Centinela'];
// Criterio de diseño (12/08): cada modelo de placa tiene UN chip inamovible —
// el servidor lo impone aunque el cliente mande otra cosa. Placa nueva = una línea.
const CHIP_POR_MODELO = {
  'Multivac 1.0/7.1': 'esp32',
  'Multivac 8.0': 'esp32s3',
  'Lector de pulsos RS485': 'esp32c3',
  'Sensor ultrasónico RS485': 'esp32c3',
  'Lector de bombas RS485': 'esp32c3',
};
const MAX_RELEASES = 60;
const MAX_SEGMENTOS = 8;

router.get('/firmwares', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_FIRMWARES);
    let firmwares = [];
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) firmwares = p; } catch { /* vacío */ } }
    res.json({ firmwares, chips: CHIPS });
  } catch (e) { next(e); }
});

router.put('/firmwares', async (req, res, next) => {
  try {
    const entrada = req.body?.firmwares;
    if (!Array.isArray(entrada)) throw new ApiError(400, 'bad_request', 'Se espera { firmwares: [...] }');
    if (entrada.length > MAX_RELEASES) throw new ApiError(400, 'bad_request', `Máximo ${MAX_RELEASES} releases`);
    const hexOk = (v) => /^0x[0-9a-fA-F]{1,8}$/.test(String(v || '').trim());
    const firmwares = entrada
      .map((f) => {
        const modelo = String(f?.modelo || '').trim().slice(0, 80);
        return ({
        modelo,
        chip: CHIP_POR_MODELO[modelo] || (CHIPS.includes(f?.chip) ? f.chip : 'esp32'),
        version: String(f?.version || '').trim().slice(0, 40),
        // Rediseño 12/08 (mockup de Leonardo): columnas Producto | Versión |
        // Nombre | Archivos | Comentario, y flujo de aprobación en dos vistas.
        producto: PRODUCTOS_FW.includes(f?.producto) ? f.producto : 'General',
        nombre: String(f?.nombre || '').trim().slice(0, 120),
        // aprobado=true ⇒ visible en "Actualizaciones de firmware" (todos los
        // usuarios habilitados). false ⇒ solo en "Gestión de versiones" (área).
        aprobado: f?.aprobado === true,
        notas: String(f?.notas || '').trim().slice(0, 1000),
        flash: {
          mode: String(f?.flash?.mode || 'keep').slice(0, 10),
          freq: String(f?.flash?.freq || 'keep').slice(0, 10),
          size: String(f?.flash?.size || 'keep').slice(0, 10),
        },
        // Backup del proyecto completo (.zip/.rar) — no se flashea, se descarga.
        fuente: f?.fuente?.key ? { key: String(f.fuente.key).trim(), nombre: String(f.fuente.nombre || '').slice(0, 160), tamano: f.fuente.tamano != null ? Number(f.fuente.tamano) : null, sha256: /^[0-9a-f]{64}$/.test(f.fuente.sha256) ? f.fuente.sha256 : null } : null,
        // Imagen merged (mapa completo de flash) — modo "volver a fábrica":
        // BORRA config y mediciones a propósito (se flashea con erase-all @0x0).
        merged: f?.merged?.key ? { key: String(f.merged.key).trim(), nombre: String(f.merged.nombre || '').slice(0, 160), tamano: f.merged.tamano != null ? Number(f.merged.tamano) : null, sha256: /^[0-9a-f]{64}$/.test(f.merged.sha256) ? f.merged.sha256 : null } : null,
        segmentos: (Array.isArray(f?.segmentos) ? f.segmentos : [])
          .slice(0, MAX_SEGMENTOS)
          .map((sg) => ({
            offset: String(sg?.offset || '').trim(),
            key: String(sg?.key || '').trim(),
            nombre: String(sg?.nombre || '').trim().slice(0, 120),
            tamano: sg?.tamano != null ? Number(sg.tamano) : null,
            sha256: /^[0-9a-f]{64}$/.test(sg?.sha256) ? sg.sha256 : null,
          }))
          .filter((sg) => hexOk(sg.offset) && sg.key),
        fecha: f?.fecha ? String(f.fecha).slice(0, 30) : new Date().toISOString(),
        subidoPor: String(f?.subidoPor || '').trim().slice(0, 80) || (req.colaborador?.nombre ?? null),
      }); })
      .filter((f) => f.modelo && f.version && (f.segmentos.length || f.merged));
    await setConfig(CLAVE_FIRMWARES, JSON.stringify(firmwares));
    res.json({ firmwares });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// LA SOLDADURA (ola B): del planteo CriterIA al aprovisionamiento.
// Solo lectura: el planteo vive en Lead.presupuestoAguaEstado
// (estado.criteria.planteo.asignacion_recursos, generado por /criteria/generar).
// ---------------------------------------------------------------------------
const planteoDe = (estado) => estado?.criteria?.planteo || estado?.planteo || null;

router.get('/aprovisionamiento', async (req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({
      select: { id: true, organizacion: true, ciudad: true, etapa: true, presupuestoAguaEstado: true },
    });
    const conPlanteo = leads
      .map((l) => {
        const p = planteoDe(l.presupuestoAguaEstado);
        const equipos = Array.isArray(p?.asignacion_recursos) ? p.asignacion_recursos.length : 0;
        return equipos ? { id: l.id, organizacion: l.organizacion, ciudad: l.ciudad, etapa: l.etapa, equipos } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.organizacion.localeCompare(b.organizacion));
    res.json({ leads: conPlanteo });
  } catch (e) { next(e); }
});

router.get('/aprovisionamiento/:leadId', async (req, res, next) => {
  try {
    const l = await prisma.lead.findUnique({
      where: { id: Number(req.params.leadId) },
      select: { id: true, organizacion: true, ciudad: true, presupuestoAguaEstado: true },
    });
    if (!l) throw new ApiError(404, 'not_found', 'Lead no encontrado');
    const p = planteoDe(l.presupuestoAguaEstado);
    if (!p || !Array.isArray(p.asignacion_recursos) || !p.asignacion_recursos.length) {
      throw new ApiError(404, 'not_found', 'El lead no tiene planteo CriterIA con asignación de recursos');
    }
    res.json({
      lead: { id: l.id, organizacion: l.organizacion, ciudad: l.ciudad },
      resumen: p.resumen_analisis || null,
      asignacion_recursos: p.asignacion_recursos,
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Carpetas de la biblioteca de Documentación (18/08). SIN migración: la lista
// de carpetas es una clave JSON en Configuracion; cada PDF guarda su carpeta
// en el campo `url` de su referencia Archivo (libre en este contexto — el
// binario vive en MinIO y se resuelve por `key`).
// ---------------------------------------------------------------------------
const CLAVE_DOC_CARPETAS = 'multivac_doc_carpetas';
const MAX_CARPETAS = 40;

router.get('/docs-carpetas', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_DOC_CARPETAS);
    let carpetas = [];
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) carpetas = p; } catch { /* vacío */ } }
    res.json({ carpetas });
  } catch (e) { next(e); }
});

// Crear/eliminar carpetas queda para la conducción (misma regla que borrar
// documentos): manager/gerencial.
router.put('/docs-carpetas', async (req, res, next) => {
  try {
    if (!['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Solo manager/gerencial administra las carpetas');
    }
    const entrada = req.body?.carpetas;
    if (!Array.isArray(entrada)) throw new ApiError(400, 'bad_request', 'Se espera { carpetas: [...] }');
    const vistas = new Set();
    const carpetas = entrada
      .map((c) => String(c || '').trim().slice(0, 60))
      .filter((c) => { if (!c) return false; const k = c.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; })
      .slice(0, MAX_CARPETAS);
    await setConfig(CLAVE_DOC_CARPETAS, JSON.stringify(carpetas));
    res.json({ carpetas });
  } catch (e) { next(e); }
});

export default router;

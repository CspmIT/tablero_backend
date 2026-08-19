import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { getConfig, setConfig } from '../lib/config.js';
import { requireTipo } from '../middleware/auth.js';
const router = Router();

const toDate = (v) => new Date(typeof v === 'string' && v.length === 10 ? v + 'T00:00:00Z' : v);

// ---------------------------------------------------------------------------
// GRILLA TÍPICA (19/08, pedido de los colaboradores vía Leonardo). SIN
// migración: la semana default por colaborador vive en la clave JSON
// `grilla_tipica` de Configuracion:
//   { "<colaboradorId>": { "1".."5": { estado: 'present'|'home_office',
//                                      entryTime: 'HH:MM' } } }   (1=lunes)
// El default es VISUAL: la grilla lo muestra en días sin carga y el editor
// del día lo precarga — recién se escribe en la base cuando alguien GUARDA el
// día. Así la base sigue diciendo la verdad (nadie figura presente sin
// confirmarlo) y feriados/vacaciones/carga real pisan el default solos.
// ---------------------------------------------------------------------------
const CLAVE_TIPICA = 'grilla_tipica';
const ESTADOS_TIPICA = ['present', 'home_office'];

router.get('/tipica', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_TIPICA);
    let tipica = {};
    if (raw) { try { const p = JSON.parse(raw); if (p && typeof p === 'object') tipica = p; } catch { /* vacío */ } }
    res.json({ tipica });
  } catch (e) { next(e); }
});

router.put('/tipica', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const entrada = req.body?.tipica;
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      throw new ApiError(400, 'bad_request', 'Se espera { tipica: { colaboradorId: { 1..5: {...} } } }');
    }
    // Saneo: solo días 1..5, estados permitidos, hora HH:MM.
    const tipica = {};
    for (const [colabId, dias] of Object.entries(entrada)) {
      if (!/^\d+$/.test(colabId) || !dias || typeof dias !== 'object') continue;
      const limpio = {};
      for (const d of ['1', '2', '3', '4', '5']) {
        const v = dias[d];
        if (!v || typeof v !== 'object' || !ESTADOS_TIPICA.includes(v.estado)) continue;
        const entryTime = v.estado === 'present' && /^\d{2}:\d{2}$/.test(String(v.entryTime || '')) ? v.entryTime : null;
        limpio[d] = entryTime ? { estado: v.estado, entryTime } : { estado: v.estado };
      }
      if (Object.keys(limpio).length) tipica[colabId] = limpio;
    }
    await setConfig(CLAVE_TIPICA, JSON.stringify(tipica));
    res.json({ tipica });
  } catch (e) { next(e); }
});

// Vacaciones por RANGO (19/08): crea entradas reales estado 'vacaciones' en
// los días hábiles del rango. SOLO CREA — jamás toca un día ya cargado (ni
// feriados ni fines de semana). Reversible día a día desde el editor.
router.post('/vacaciones', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const colaboradorId = Number(req.body?.colaboradorId);
    const desde = toDate(req.body?.desde);
    const hasta = toDate(req.body?.hasta);
    if (!colaboradorId || !desde || !hasta || Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
      throw new ApiError(400, 'bad_request', 'Se espera { colaboradorId, desde, hasta } (YYYY-MM-DD)');
    }
    if (hasta < desde) throw new ApiError(400, 'bad_request', 'El fin es anterior al inicio');
    const dias = Math.round((hasta - desde) / 86400000) + 1;
    if (dias > 92) throw new ApiError(400, 'bad_request', 'Rango demasiado largo (máximo 3 meses) — ¿fecha mal tipeada?');
    const [existentes, feriados] = await Promise.all([
      prisma.grillaEntrada.findMany({ where: { colaboradorId, fecha: { gte: desde, lte: hasta } }, select: { fecha: true } }),
      prisma.feriado.findMany({ where: { fecha: { gte: desde, lte: hasta } }, select: { fecha: true } }),
    ]);
    const iso = (d) => d.toISOString().slice(0, 10);
    const setExistentes = new Set(existentes.map((e) => iso(e.fecha)));
    const setFeriados = new Set(feriados.map((f) => iso(f.fecha)));
    let creados = 0; let yaCargados = 0; let enFeriado = 0; let finde = 0;
    for (let t = desde.getTime(); t <= hasta.getTime(); t += 86400000) {
      const d = new Date(t);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) { finde++; continue; }             // fin de semana
      if (setFeriados.has(iso(d))) { enFeriado++; continue; }        // el feriado pisa
      if (setExistentes.has(iso(d))) { yaCargados++; continue; }     // lo cargado es sagrado
      // eslint-disable-next-line no-await-in-loop
      await prisma.grillaEntrada.create({ data: { colaboradorId, fecha: d, estado: 'vacaciones' } });
      creados++;
    }
    res.json({ ok: true, creados, yaCargados, enFeriado, finde });
  } catch (e) { next(e); }
});

// --- Entradas de la grilla (un registro por colaborador y día) ---
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.colaboradorId) where.colaboradorId = Number(req.query.colaboradorId);
    if (req.query.desde || req.query.hasta) {
      where.fecha = {};
      if (req.query.desde) where.fecha.gte = toDate(req.query.desde);
      if (req.query.hasta) where.fecha.lte = toDate(req.query.hasta);
    }
    const data = await prisma.grillaEntrada.findMany({ where, orderBy: { fecha: 'asc' } });
    res.json(data);
  } catch (e) { next(e); }
});

// Métricas OV (18/08): id estable por ítem + MERGE por id en el guardado del
// día. Regla dura del diseño: la clasificación (ovTipo/ovCausa/...) vive
// adentro del ítem; si un frontend viejo manda el ítem SIN esos campos, acá
// se preservan desde lo ya guardado — el PUT nunca pisa la clasificación.
const nuevoItemId = () => 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const CAMPOS_OV = ['ovTipo', 'ovCausa', 'ovDescartado', 'ovPor', 'ovFecha'];
function mergeItemsPorId(entrantes, previos) {
  if (!Array.isArray(entrantes)) return entrantes ?? null;
  const prevPorId = new Map(
    (Array.isArray(previos) ? previos : [])
      .filter((p) => p && typeof p === 'object' && p.id)
      .map((p) => [p.id, p]),
  );
  return entrantes.map((it) => {
    if (!it || typeof it !== 'object') return it; // ítems legacy (string) intactos
    const base = { ...it };
    if (!base.id) base.id = nuevoItemId(); // regla nº3: sin id no se descarta, se asigna
    const prev = prevPorId.get(base.id);
    if (prev) {
      for (const k of CAMPOS_OV) {
        if (base[k] === undefined && prev[k] !== undefined) base[k] = prev[k];
      }
    }
    return base;
  });
}

// Crear o actualizar la entrada de un día (clave: colaboradorId + fecha)
router.put('/', async (req, res, next) => {
  try {
    const colaboradorId = Number(req.body.colaboradorId);
    const fecha = toDate(req.body.fecha);
    const estado = req.body.estado ?? req.body.status ?? 'present';
    // Merge por id contra lo ya guardado (no reemplazo ciego del array).
    const previa = await prisma.grillaEntrada.findUnique({
      where: { colaboradorId_fecha: { colaboradorId, fecha } },
      select: { items: true },
    });
    const payload = {
      estado,
      entryTime: estado === 'present' ? (req.body.entry_time ?? req.body.entryTime ?? null) : null,
      viajeLabel: estado === 'viaje' ? (req.body.viaje_label ?? req.body.viajeLabel ?? null) : null,
      items: mergeItemsPorId(req.body.items ?? null, previa?.items),
      horasExtra: req.body.horas_extra ?? req.body.horasExtra ?? null,
    };
    const entry = await prisma.grillaEntrada.upsert({
      where: { colaboradorId_fecha: { colaboradorId, fecha } },
      update: payload,
      create: { colaboradorId, fecha, ...payload },
    });
    res.json(entry);
  } catch (e) { next(e); }
});

// Carga masiva (importador de grilla desde Excel)
router.post('/bulk', async (req, res, next) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    let creados = 0;
    const errores = [];
    for (const e of entries) {
      const colaboradorId = Number(e.colaboradorId);
      const f = toDate(e.fecha);
      const estado = e.estado || 'present';
      if (!colaboradorId || !f) { errores.push(`${e.fecha}: datos incompletos`); continue; }
      const payload = {
        estado,
        entryTime: estado === 'present' ? (e.entryTime ?? null) : null,
        viajeLabel: estado === 'viaje' ? (e.viajeLabel ?? null) : null,
        items: e.items ?? null,
        horasExtra: e.horasExtra ?? null,
      };
      try {
        await prisma.grillaEntrada.upsert({
          where: { colaboradorId_fecha: { colaboradorId, fecha: f } },
          update: payload,
          create: { colaboradorId, fecha: f, ...payload },
        });
        creados++;
      } catch (err) { errores.push(`${e.fecha} (colab ${colaboradorId}): ${err.message}`); }
    }
    res.json({ ok: true, creados, errores });
  } catch (e) { next(e); }
});

// Borrar lo cargado para un día (DayEditModal -> onSave(null))
router.delete('/', async (req, res, next) => {
  try {
    await prisma.grillaEntrada.deleteMany({
      where: { colaboradorId: Number(req.query.colaboradorId), fecha: toDate(req.query.fecha) },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

// --- WIP semanal (foco principal de la semana por colaborador) ---
router.get('/wips', async (req, res, next) => {
  try {
    res.json(await prisma.weeklyWip.findMany());
  } catch (e) { next(e); }
});

// Upsert del WIP semanal; texto vacío => se borra.
router.put('/wip', async (req, res, next) => {
  try {
    const colaboradorId = Number(req.body.colaboradorId);
    const anio = Number(req.body.anio);
    const semanaIso = Number(req.body.semanaIso);
    const texto = (req.body.texto ?? '').trim();
    const key = { colaboradorId_anio_semanaIso: { colaboradorId, anio, semanaIso } };
    if (!texto) {
      await prisma.weeklyWip.deleteMany({ where: { colaboradorId, anio, semanaIso } });
      return res.status(204).end();
    }
    const row = await prisma.weeklyWip.upsert({
      where: key,
      update: { texto },
      create: { colaboradorId, anio, semanaIso, texto },
    });
    res.json(row);
  } catch (e) { next(e); }
});

// --- Resumen semanal de costos, hermanado con la grilla (26/07) -------------
// El "resumen de la semana" que administración carga en Costos (campo summary
// de cada semana) se ve y se edita también desde el casillero del WIP de la
// grilla. Un solo dato, dos superficies. Las semanas de costos arrancan en el
// primer lunes >= día 1 del mes (idéntico ancla que la grilla): el mapeo es
// directo por la fecha del lunes. Vive en este router (no en /costos) porque
// los colaboradores no tienen la solapa Costos y este dato sí es de todos.
function lunesDelMes(mesKey) {
  const [y, m] = mesKey.split('-').map(Number);
  const lunes = [];
  const d = new Date(Date.UTC(y, m - 1, 1));
  const dow = d.getUTCDay() || 7;
  if (dow !== 1) d.setUTCDate(d.getUTCDate() + (8 - dow));
  while (d.getUTCMonth() === m - 1) {
    lunes.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return lunes;
}

function sumaUnidades(unidades) {
  return Object.values(unidades || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

// GET /grilla/resumen-semana?lunes=YYYY-MM-DD →
//   { resumenes: {colabId: texto}, cooptechPct: {colabId: 0..1|null} }
router.get('/resumen-semana', async (req, res, next) => {
  try {
    const lunes = String(req.query.lunes || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lunes)) throw new ApiError(400, 'bad_request', 'Falta el lunes (YYYY-MM-DD)');
    const mes = lunes.slice(0, 7);
    const idx = lunesDelMes(mes).indexOf(lunes);
    const resumenes = {}, cooptechPct = {};
    if (idx >= 0) {
      const cm = await prisma.costoMensual.findUnique({ where: { mes } });
      const asig = cm?.asignaciones || {};
      for (const [cid, fila] of Object.entries(asig)) {
        const w = Array.isArray(fila?.weeks) ? fila.weeks[idx] : null;
        if (w?.summary) resumenes[cid] = w.summary;
        if (w && w.unidades && Object.keys(w.unidades).length > 0) {
          cooptechPct[cid] = Math.max(0, 1 - sumaUnidades(w.unidades));
        }
      }
    }
    res.json({ resumenes, cooptechPct });
  } catch (e) { next(e); }
});

// PUT /grilla/resumen-semana { colaboradorId, lunes, summary }
// Permiso: el propio colaborador o un manager. Merge quirúrgico: solo el
// summary de esa semana; las unidades y el resto quedan intactos.
router.put('/resumen-semana', async (req, res, next) => {
  try {
    const colaboradorId = Number(req.body?.colaboradorId);
    const lunes = String(req.body?.lunes || '');
    const summary = String(req.body?.summary ?? '').trim();
    if (!colaboradorId || !/^\d{4}-\d{2}-\d{2}$/.test(lunes)) throw new ApiError(400, 'bad_request', 'Faltan colaborador o lunes');
    if (req.colaborador?.tipo !== 'manager' && req.colaborador?.id !== colaboradorId) {
      throw new ApiError(403, 'forbidden', 'Solo podés editar tu propio resumen semanal');
    }
    const mes = lunes.slice(0, 7);
    const lunesMes = lunesDelMes(mes);
    const idx = lunesMes.indexOf(lunes);
    if (idx < 0) throw new ApiError(400, 'bad_request', 'Ese lunes no pertenece a las semanas del mes (arrancan el primer lunes del mes)');

    const cm = await prisma.costoMensual.findUnique({ where: { mes } });
    const asig = (cm?.asignaciones && typeof cm.asignaciones === 'object') ? { ...cm.asignaciones } : {};
    const fila = (asig[colaboradorId] && typeof asig[colaboradorId] === 'object') ? { ...asig[colaboradorId] } : {};
    const weeks = Array.from({ length: lunesMes.length }, (_, i) => {
      const w = Array.isArray(fila.weeks) ? fila.weeks[i] : null;
      return { summary: w?.summary || '', unidades: { ...(w?.unidades || {}) } };
    });
    weeks[idx] = { ...weeks[idx], summary };
    fila.weeks = weeks;
    asig[colaboradorId] = fila;

    await prisma.costoMensual.upsert({
      where: { mes },
      update: { asignaciones: asig },
      create: { mes, asignaciones: asig },
    });
    res.json({ ok: true, summary });
  } catch (e) { next(e); }
});

export default router;

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
const router = Router();

const toDate = (v) => new Date(typeof v === 'string' && v.length === 10 ? v + 'T00:00:00Z' : v);

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

// Crear o actualizar la entrada de un día (clave: colaboradorId + fecha)
router.put('/', async (req, res, next) => {
  try {
    const colaboradorId = Number(req.body.colaboradorId);
    const fecha = toDate(req.body.fecha);
    const estado = req.body.estado ?? req.body.status ?? 'present';
    const payload = {
      estado,
      entryTime: estado === 'present' ? (req.body.entry_time ?? req.body.entryTime ?? null) : null,
      viajeLabel: estado === 'viaje' ? (req.body.viaje_label ?? req.body.viajeLabel ?? null) : null,
      items: req.body.items ?? null,
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

export default router;

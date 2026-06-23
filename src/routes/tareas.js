import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
const router = Router();

const coerceFecha = (v) => {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00.000Z');
  return isNaN(d.getTime()) ? null : d;
};

const include = { responsables: true, tags: { include: { tag: true } } };

function flatten(t) {
  return {
    ...t,
    responsables: undefined,
    ownersIds: (t.responsables || []).map((r) => r.colaboradorId),
    tagIds: (t.tags || []).map((tt) => tt.tagId),
    tags: (t.tags || []).map((tt) => tt.tag), // tags resueltos {id, nombre, color, categoria}
  };
}

function scalarData(body) {
  const out = {};
  for (const k of ['proyectoId', 'titulo', 'descripcion', 'kanbanCol', 'prioridad', 'orden']) {
    if (k in body) out[k] = k === 'proyectoId' ? (body[k] ? Number(body[k]) : null) : body[k];
  }
  for (const k of ['fechaInicio', 'fechaFin', 'startedAt', 'closedAt']) if (k in body) out[k] = coerceFecha(body[k]);
  if ('pct' in body) out.pct = body.pct === null || body.pct === '' ? null : Number(body.pct);
  if ('weight' in body) out.weight = Number(body.weight) || 1;
  if ('unidades' in body) out.unidades = body.unidades ?? null;
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.proyectoId) where.proyectoId = Number(req.query.proyectoId);
    const rows = await prisma.tarea.findMany({ where, include, orderBy: [{ kanbanCol: 'asc' }, { orden: 'asc' }] });
    res.json(rows.map(flatten));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = scalarData(req.body);
    if (Array.isArray(req.body.ownersIds)) data.responsables = { create: req.body.ownersIds.map((id) => ({ colaboradorId: Number(id) })) };
    if (Array.isArray(req.body.tagIds)) data.tags = { create: req.body.tagIds.map((id) => ({ tagId: Number(id) })) };
    const row = await prisma.tarea.create({ data, include });
    res.status(201).json(flatten(row));
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = scalarData(req.body);
    if (Array.isArray(req.body.ownersIds)) {
      await prisma.tareaResponsable.deleteMany({ where: { tareaId: id } });
      data.responsables = { create: req.body.ownersIds.map((x) => ({ colaboradorId: Number(x) })) };
    }
    if (Array.isArray(req.body.tagIds)) {
      await prisma.tareaTag.deleteMany({ where: { tareaId: id } });
      data.tags = { create: req.body.tagIds.map((x) => ({ tagId: Number(x) })) };
    }
    const row = await prisma.tarea.update({ where: { id }, data, include });
    res.json(flatten(row));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.tarea.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;

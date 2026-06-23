import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await prisma.costoMensual.findMany({ orderBy: { mes: 'desc' } });
    res.json({ data });
  } catch (e) { next(e); }
});

router.get('/:mes', async (req, res, next) => {
  try {
    const c = await prisma.costoMensual.findUnique({ where: { mes: req.params.mes } });
    if (!c) throw new ApiError(404, 'not_found', 'Sin costos para ese mes');
    res.json(c);
  } catch (e) { next(e); }
});

router.put('/:mes', async (req, res, next) => {
  try {
    const payload = {
      costoLaboral: req.body.costoLaboral ?? null,
      cotizacionDolar: req.body.cotizacionDolar ?? null,
    };
    if ('asignaciones' in req.body) payload.asignaciones = req.body.asignaciones ?? null;
    const c = await prisma.costoMensual.upsert({
      where: { mes: req.params.mes },
      update: payload,
      create: { mes: req.params.mes, ...payload },
    });
    res.json(c);
  } catch (e) { next(e); }
});

export default router;

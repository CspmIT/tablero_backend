import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
const router = Router();

// Todas las semanas de guardia del año (default: año actual).
router.get('/', async (req, res, next) => {
  try {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const data = await prisma.guardiaSemana.findMany({ where: { anio }, orderBy: { week: 'asc' } });
    res.json(data);
  } catch (e) { next(e); }
});

// Upsert de una semana (clave: anio + week). Reemplaza el set de asignaciones.
router.put('/', async (req, res, next) => {
  try {
    const anio = Number(req.body.anio);
    const week = Number(req.body.week);
    const range = req.body.range ?? '';
    const asignaciones = Array.isArray(req.body.asignaciones) ? req.body.asignaciones : [];
    const row = await prisma.guardiaSemana.upsert({
      where: { anio_week: { anio, week } },
      update: { range, asignaciones },
      create: { anio, week, range, asignaciones },
    });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;

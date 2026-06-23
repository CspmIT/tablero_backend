import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
const router = Router();

// Acarreo de francos del año anterior, por colaborador.
router.get('/', async (req, res, next) => {
  try {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    res.json(await prisma.carryover.findMany({ where: { anio } }));
  } catch (e) { next(e); }
});

router.put('/', async (req, res, next) => {
  try {
    const colaboradorId = Number(req.body.colaboradorId);
    const anio = Number(req.body.anio);
    const dias = Number(req.body.dias) || 0;
    const row = await prisma.carryover.upsert({
      where: { colaboradorId_anio: { colaboradorId, anio } },
      update: { dias },
      create: { colaboradorId, anio, dias },
    });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;

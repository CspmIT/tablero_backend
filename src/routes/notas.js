// Mis notas (ola 3, 07/08) — texto libre semanal por persona, dentro de
// Novedades del CRM. Visibilidad: todos ven las de todos; cada uno edita SOLO
// la suya (el autor sale del token, nunca del body). Clave de semana idéntica
// a la del WIP de la grilla: año calendario del lunes + número de semana ISO.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

// GET /notas?anio=&semanaIso= → las notas de esa semana de TODO el equipo.
router.get('/', async (req, res, next) => {
  try {
    const anio = Number(req.query.anio);
    const semanaIso = Number(req.query.semanaIso);
    if (!anio || !semanaIso) throw new ApiError(400, 'bad_request', 'Faltan anio y semanaIso');
    const filas = await prisma.notaSemanal.findMany({
      where: { anio, semanaIso },
      include: { colaborador: { select: { id: true, nombre: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({
      notas: filas.map((n) => ({
        colaboradorId: n.colaboradorId,
        nombre: n.colaborador?.nombre || '—',
        texto: n.texto,
        updatedAt: n.updatedAt,
      })),
    });
  } catch (e) { next(e); }
});

// PUT /notas { anio, semanaIso, texto } → upsert de la PROPIA nota.
// Texto vacío = se borra (patrón WIP). Sin DELETE genérico.
router.put('/', async (req, res, next) => {
  try {
    const colaboradorId = req.colaborador?.id;
    if (!colaboradorId) throw new ApiError(401, 'unauthorized', 'Sesión inválida');
    const anio = Number(req.body?.anio);
    const semanaIso = Number(req.body?.semanaIso);
    if (!anio || !semanaIso) throw new ApiError(400, 'bad_request', 'Faltan anio y semanaIso');
    const texto = String(req.body?.texto ?? '').trim();
    const key = { colaboradorId_anio_semanaIso: { colaboradorId, anio, semanaIso } };
    if (!texto) {
      // Solo borra LA PROPIA nota de ESA semana (colaboradorId del token).
      await prisma.notaSemanal.deleteMany({ where: { colaboradorId, anio, semanaIso } });
      return res.status(204).end();
    }
    const row = await prisma.notaSemanal.upsert({
      where: key,
      update: { texto },
      create: { colaboradorId, anio, semanaIso, texto },
    });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;

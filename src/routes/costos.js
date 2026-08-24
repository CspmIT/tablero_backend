import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireTipo } from '../middleware/auth.js';
import { generarExcelCostos } from '../lib/exportCostosExcel.js';
const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await prisma.costoMensual.findMany({ orderBy: { mes: 'desc' } });
    res.json({ data });
  } catch (e) { next(e); }
});

// GET /costos/exportar-excel?anio=2026 — el anualizado en el formato exacto
// del Excel de administración (plantilla real): Nadia descarga y reemplaza.
router.get('/exportar-excel', async (req, res, next) => {
  try {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const [costos, colaboradores] = await Promise.all([
      prisma.costoMensual.findMany({ where: { mes: { startsWith: `${anio}-` } } }),
      prisma.colaborador.findMany({ select: { id: true, nombre: true, funcionCosto: true } }),
    ]);
    const meses = Object.fromEntries(costos.map((c) => [c.mes, c]));
    const buffer = await generarExcelCostos({ anio, meses, colaboradores });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Costos_Operacion_Cooptech_${anio}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (e) { next(e); }
});

router.get('/:mes', async (req, res, next) => {
  try {
    const c = await prisma.costoMensual.findUnique({ where: { mes: req.params.mes } });
    if (!c) throw new ApiError(404, 'not_found', 'Sin costos para ese mes');
    res.json(c);
  } catch (e) { next(e); }
});

// Escribir costos (sueldos): solo manager (hardening 24/08).
router.put('/:mes', requireTipo('manager'), async (req, res, next) => {
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

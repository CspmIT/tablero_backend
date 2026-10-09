import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { getConfig, setConfig } from '../lib/config.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
const router = Router();

// ---- Exportador para el sistema de RRHH (Mirko) — 09/10, ítem 1 del backlog.
// El tablero no conoce los LEGAJOS ni el nombre con el que RRHH lista a cada
// persona: ese mapeo (+ el nombre del área) vive acá, en Configuracion (SIN
// migración), compartido por todos los que exportan. El xlsx se arma en el
// frontend (SheetJS, dependencia ya presente) con el formato EXACTO del
// importador de Mirko. Rutas literales ANTES de las genéricas (lección 05/08).
const CLAVE_EXPORT_RRHH = 'guardias_export_rrhh';

// GET /guardias/export-rrhh → { config } (null si nunca se completó).
router.get('/export-rrhh', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_EXPORT_RRHH);
    let config = null;
    if (raw) { try { config = JSON.parse(raw); } catch { config = null; } }
    res.json({ config });
  } catch (e) { next(e); }
});

// PUT /guardias/export-rrhh { config } — solo conducción (es dato maestro:
// legajos y nombres oficiales de RRHH, no algo que cada uno retoque).
router.put('/export-rrhh', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ApiError(400, 'bad_request', 'Se espera { config: { area, colaboradores } }');
    }
    const json = JSON.stringify(config);
    if (json.length > 20000) throw new ApiError(400, 'bad_request', 'El mapeo es demasiado grande');
    await setConfig(CLAVE_EXPORT_RRHH, json);
    res.json({ config });
  } catch (e) { next(e); }
});

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

// Solapa "Análisis": reportes agregados sobre datos existentes.
// Primer reporte: horas extra por colaborador con selector de mes.
// Visible para manager, gerencial y externo (otras áreas, ej. RRHH).
import { Router } from 'express';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { resumenHorasExtra } from '../lib/asistenteTools.js';

const router = Router();

router.use(requireTipo('manager', 'gerencial', 'externo'));

// GET /analisis/horas-extra?mes=YYYY-MM
router.get('/horas-extra', async (req, res, next) => {
  try {
    const mes = String(req.query.mes || '');
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      throw new ApiError(400, 'bad_request', 'Indicá el mes en formato YYYY-MM');
    }
    res.json(await resumenHorasExtra(mes));
  } catch (e) { next(e); }
});

export default router;

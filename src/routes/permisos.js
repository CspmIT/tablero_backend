// Permisos de UI por usuario (panel de administración de vistas).
// Guarda overrides en la tabla Configuracion (clave única 'ui_permisos'):
//   { "<colaboradorId>": { extra: ['costos'], ocultas: ['crm'] } }
// `extra` suma solapas que el rol no daría; `ocultas` resta solapas del rol.
// Caso que lo originó (16/07): Nadia (administración) necesitaba ver Costos
// sin ser manager — antes, cada caso así era un cambio de código.
import { Router } from 'express';
import { getConfig, setConfig } from '../lib/config.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const CLAVE = 'ui_permisos';

export async function leerOverrides() {
  try {
    const raw = await getConfig(CLAVE);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === 'object' ? map : {};
  } catch { return {}; }
}

export function solapasDe(overrides, colaboradorId) {
  const o = overrides[String(colaboradorId)] || {};
  return {
    extra: Array.isArray(o.extra) ? o.extra : [],
    ocultas: Array.isArray(o.ocultas) ? o.ocultas : [],
  };
}

// Middleware: permite por tipo O por solapa extra otorgada en el panel.
// La visibilidad de la solapa y la autorización del endpoint van juntas.
export function permitirTipoOSolapa(solapaId, ...tipos) {
  return async (req, res, next) => {
    try {
      const c = req.colaborador;
      if (c && tipos.includes(c.tipo)) return next();
      if (c) {
        const ov = solapasDe(await leerOverrides(), c.id);
        if (ov.extra.includes(solapaId) && !ov.ocultas.includes(solapaId)) return next();
      }
      throw new ApiError(403, 'forbidden', 'No tenés permiso para esta sección');
    } catch (e) { next(e); }
  };
}

const router = Router();
router.use(requireTipo('manager'));

// GET /permisos → mapa completo de overrides (para el panel)
router.get('/', async (req, res, next) => {
  try { res.json({ overrides: await leerOverrides() }); }
  catch (e) { next(e); }
});

// PUT /permisos { colaboradorId, extra: [], ocultas: [] }
router.put('/', async (req, res, next) => {
  try {
    const id = Number(req.body?.colaboradorId);
    if (!id) throw new ApiError(400, 'bad_request', 'Falta colaboradorId');
    const overrides = await leerOverrides();
    const extra = Array.isArray(req.body?.extra) ? req.body.extra.filter(x => typeof x === 'string') : [];
    const ocultas = Array.isArray(req.body?.ocultas) ? req.body.ocultas.filter(x => typeof x === 'string') : [];
    if (!extra.length && !ocultas.length) delete overrides[String(id)];
    else overrides[String(id)] = { extra, ocultas };
    await setConfig(CLAVE, JSON.stringify(overrides));
    res.json({ ok: true, overrides });
  } catch (e) { next(e); }
});

export default router;

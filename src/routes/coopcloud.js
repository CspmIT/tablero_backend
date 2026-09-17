// Simulador CoopCloud (17/09) — la definición GLOBAL de precios y monómicos.
//
// El presupuestador de CoopCloud tiene dos usos: con un lead (el presupuesto
// de ese cliente, que vive en `lead.coopcloudEstado`) y SIN lead, que es esta
// definición: los valores de referencia con los que se arman todos los
// presupuestos. Ese segundo caso vivía en el `localStorage` de cada navegador,
// así que cada uno veía los suyos (hallazgo de Leonardo sobre el fix del
// presupuestador por lead).
//
// Ahora es UNA sola definición, en la clave cifrada `coopcloud_simulador` de
// Configuracion. SIN migración: misma tabla que la grilla típica.
//   Lectura:   cualquier colaborador habilitado (la usa el presupuestador).
//   Escritura: manager/gerencial, como la grilla típica — es un parámetro de
//              conducción, no algo que cada uno ajuste para su presupuesto.
// A quien no puede escribir, el front le avisa «solo lectura» con el 403 y no
// insiste.
import { Router } from 'express';
import { requireTipo } from '../middleware/auth.js';
import { getConfig, setConfig } from '../lib/config.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

const CLAVE_SIMULADOR = 'coopcloud_simulador';
// El estado lo define el HTML del presupuestador (public/presupuestadores/
// coopcloud.html) y cambia con él, así que acá NO se valida campo por campo:
// se guarda el objeto tal cual, con un techo de tamaño para que no entre
// cualquier cosa.
const MAX_BYTES = 256 * 1024;

// GET /coopcloud/simulador → { estado } (null si todavía nadie la sembró: el
// presupuestador entonces rescata, una sola vez, lo que tenga ese navegador).
router.get('/simulador', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_SIMULADOR);
    let estado = null;
    if (raw) { try { estado = JSON.parse(raw); } catch { /* config corrupta: como si no hubiera */ } }
    res.json({ estado });
  } catch (e) { next(e); }
});

// PUT /coopcloud/simulador { estado } → la reemplaza entera (el front manda el
// estado completo en cada autosave, con debounce).
router.put('/simulador', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const estado = req.body?.estado;
    if (!estado || typeof estado !== 'object' || Array.isArray(estado)) {
      throw new ApiError(400, 'bad_request', 'Se espera { estado: {...} }');
    }
    const json = JSON.stringify(estado);
    if (Buffer.byteLength(json) > MAX_BYTES) {
      throw new ApiError(400, 'bad_request', 'La definición del simulador es demasiado grande');
    }
    await setConfig(CLAVE_SIMULADOR, json);
    res.json({ estado });
  } catch (e) { next(e); }
});

export default router;

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
//   Lectura:   equipo interno (manager/gerencial/collaborator).
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
// se guarda el objeto tal cual, con un techo de tamaño.
// El techo NO es arbitrario: `Configuracion.valor` es un TEXT de MySQL (65.535
// BYTES) y lo que se guarda va cifrado en base64, que agrega un tercio. O sea
// que el JSON en limpio no puede pasar de ~48.000 bytes; 45.000 deja margen.
// Pasarse no daría un error prolijo: MySQL truncaría el cifrado y la
// definición quedaría ilegible (se leería como «no configurado»).
const MAX_BYTES = 45_000;

// GET /coopcloud/simulador → { estado } (null si todavía nadie la sembró: el
// presupuestador entonces rescata, una sola vez, lo que tenga ese navegador).
// Lectura del equipo interno: los precios de la unidad no son para `externo`
// (mismo criterio que /contactos y /analisisOv).
router.get('/simulador', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
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

// Publicar precios en la web (25/09): la landing pública NO lee el simulador
// en vivo (es herramienta de trabajo: un experimento guardado cambiaría los
// precios públicos al instante). Publicar es una FOTO deliberada de los 6
// monómicos, que queda en `landing_monomicos` y sale por el endpoint público
// GET /api/landing/monomicos (routes/landing.js, montado sin login).
const MONOMICOS_LANDING = ['vcpu', 'ram', 'ssd', 'hdd', 'ip', 'mbps'];

// PUT /coopcloud/simulador/publicar { monomicos: { vcpu, ram, ssd, hdd, ip, mbps } }
router.put('/simulador/publicar', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const m = req.body?.monomicos;
    if (!m || typeof m !== 'object') {
      throw new ApiError(400, 'bad_request', 'Se espera { monomicos: { vcpu, ram, ssd, hdd, ip, mbps } }');
    }
    const limpio = {};
    for (const k of MONOMICOS_LANDING) {
      const v = Number(m[k]);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(422, 'validation', `Monómico inválido: ${k}`);
      limpio[k] = Math.round(v * 10000) / 10000; // 4 decimales, como los muestra el simulador
    }
    await setConfig('landing_monomicos', JSON.stringify({
      ...limpio,
      publicadoEl: new Date().toISOString(),
      publicadoPor: req.colaborador?.nombre || null,
    }));
    res.json({ ok: true, monomicos: limpio });
  } catch (e) { next(e); }
});

export default router;

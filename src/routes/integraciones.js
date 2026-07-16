// Gestión de la integración Microsoft Graph (Outlook/Teams) desde la app.
// Mismo patrón que la clave de Claude: solo manager, credenciales cifradas en
// Configuracion, validación EN VIVO antes de guardar (token real + acceso a la
// casilla), y estado con máscara — el secreto nunca vuelve completo al frontend.
import { Router } from 'express';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import {
  resolverGraphConfig, guardarGraphConfig, borrarGraphConfig,
  diasParaVencer, graphFetch,
} from '../lib/graph.js';

const router = Router();
router.use(requireTipo('manager'));

const mascara = (v) => v ? `${String(v).slice(0, 6)}…${String(v).slice(-4)}` : null;

async function estadoActual() {
  const cred = await resolverGraphConfig();
  if (!cred) return { configurado: false, origen: null };
  return {
    configurado: true,
    origen: cred.origen,
    tenantIdMascara: mascara(cred.tenantId),
    clientIdMascara: mascara(cred.clientId),
    casilla: cred.casilla,           // no es secreta y conviene verla completa
    vence: cred.vence || null,
    diasParaVencer: diasParaVencer(cred.vence),
  };
}

// GET /integraciones/graph → estado para la UI.
router.get('/', async (req, res, next) => {
  try { res.json(await estadoActual()); } catch (e) { next(e); }
});

// PUT /integraciones/graph { tenantId?, clientId?, clientSecret?, casilla?, vence? }
// ACTUALIZACIÓN PARCIAL (mejora 16/07): si ya hay credenciales cargadas, los
// campos vacíos conservan el valor guardado — cambiar solo la casilla (caso
// típico: pasar de la casilla de prueba a la comercial) no exige recargar los
// 5 datos. Valida ANTES de guardar: (1) token real, (2) acceso al calendario
// de la casilla. Si algo falla, NO se guarda.
router.put('/', async (req, res, next) => {
  try {
    const previa = await resolverGraphConfig(); // null si no hay nada cargado
    const tenantId = String(req.body?.tenantId || '').trim() || previa?.tenantId || '';
    const clientId = String(req.body?.clientId || '').trim() || previa?.clientId || '';
    const clientSecret = String(req.body?.clientSecret || '').trim() || previa?.clientSecret || '';
    const casilla = (String(req.body?.casilla || '').trim() || previa?.casilla || '').toLowerCase();
    // Vencimiento: si viene, se usa; si no viene y el secreto no cambió, se
    // conserva el guardado (un secreto nuevo sin fecha deja el campo vacío).
    const secretoCambio = !!String(req.body?.clientSecret || '').trim();
    const vence = req.body?.vence
      ? String(req.body.vence).slice(0, 10)
      : (!secretoCambio ? (previa?.vence || null) : null);

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(tenantId)) throw new ApiError(400, 'bad_request', 'El Tenant ID no tiene formato de identificador (GUID)');
    if (!uuidRe.test(clientId)) throw new ApiError(400, 'bad_request', 'El Client ID no tiene formato de identificador (GUID)');
    if (!clientSecret) throw new ApiError(400, 'bad_request', 'Falta el valor del secreto');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(casilla)) throw new ApiError(400, 'bad_request', 'La casilla no parece un email válido');
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw new ApiError(400, 'bad_request', 'La fecha de vencimiento debe ser AAAA-MM-DD');

    // Prueba en vivo: token + lectura del calendario de la casilla.
    const credenciales = { tenantId, clientId, clientSecret, casilla };
    try {
      await graphFetch(`/users/${encodeURIComponent(casilla)}/calendar`, { credenciales });
    } catch (e) {
      const detalle = e?.message || 'error desconocido';
      throw new ApiError(400, 'graph_validacion',
        `Las credenciales no pasaron la prueba (${detalle}). No se guardó nada: revisá los datos con el administrador.`);
    }

    await guardarGraphConfig({ tenantId, clientId, clientSecret, casilla, vence });
    res.json({ ok: true, ...(await estadoActual()) });
  } catch (e) { next(e); }
});

// DELETE /integraciones/graph → quita las credenciales cargadas desde la app
// (si existen variables de entorno, quedan como respaldo).
router.delete('/', async (req, res, next) => {
  try {
    await borrarGraphConfig();
    res.json(await estadoActual());
  } catch (e) { next(e); }
});

export default router;

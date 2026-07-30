// Suscripción a notificaciones push del navegador/PWA.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { clavePublicaVapid, TIPOS_NOTIFICACION, preferenciasDe, guardarPreferencias } from '../lib/push.js';

const router = Router();

router.get('/clave-publica', async (req, res, next) => {
  try { res.json({ clave: await clavePublicaVapid() }); } catch (e) { next(e); }
});

router.post('/suscribir', async (req, res, next) => {
  try {
    const sub = req.body?.suscripcion;
    if (!sub?.endpoint || !sub?.keys) throw new ApiError(400, 'bad_request', 'Suscripción inválida');
    await prisma.pushSuscripcion.upsert({
      where: { endpoint: String(sub.endpoint).slice(0, 500) },
      update: { colaboradorId: req.colaborador.id, datos: sub },
      create: { colaboradorId: req.colaborador.id, endpoint: String(sub.endpoint).slice(0, 500), datos: sub },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/suscribir', async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint || '').slice(0, 500);
    if (endpoint) await prisma.pushSuscripcion.deleteMany({ where: { endpoint, colaboradorId: req.colaborador.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Preferencias de notificación del usuario actual
router.get('/preferencias', async (req, res, next) => {
  try {
    res.json({ tipos: TIPOS_NOTIFICACION, mias: await preferenciasDe(req.colaborador.id) });
  } catch (e) { next(e); }
});

router.put('/preferencias', async (req, res, next) => {
  try {
    res.json({ mias: await guardarPreferencias(req.colaborador.id, req.body?.prefs || {}) });
  } catch (e) { next(e); }
});

export default router;

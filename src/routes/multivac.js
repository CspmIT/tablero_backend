// Botones Multivac (ola 3, 07/08) — ABM de comandos precargados del terminal
// de Campo → Multivac, COMPARTIDOS por todo el equipo. Patrón idéntico al
// catálogo de productos del CRM: clave JSON en Configuracion (cifrada), SIN
// migración. Cada botón: { nombre, comando, producto } con producto en
// General | +Agua | Reconecta | Centinela.
import { Router } from 'express';
import { getConfig, setConfig } from '../lib/config.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

const CLAVE = 'multivac_botones';
const PRODUCTOS = ['General', '+Agua', 'Reconecta', 'Centinela'];
const MAX_BOTONES = 100;

// Defaults si nunca se guardó nada (los atajos históricos del terminal).
const DEFAULTS = [
  { nombre: 'Ayuda', comando: 'help', producto: 'General' },
  { nombre: 'Login', comando: 'login', producto: 'General' },
  { nombre: 'Estado', comando: 'status', producto: 'General' },
  { nombre: 'Guardar', comando: 'save', producto: 'General' },
];

router.get('/botones', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE);
    let botones = DEFAULTS;
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) botones = p; } catch { /* config corrupta: defaults */ } }
    res.json({ botones, productos: PRODUCTOS });
  } catch (e) { next(e); }
});

router.put('/botones', async (req, res, next) => {
  try {
    const entrada = req.body?.botones;
    if (!Array.isArray(entrada)) throw new ApiError(400, 'bad_request', 'Se espera { botones: [...] }');
    if (entrada.length > MAX_BOTONES) throw new ApiError(400, 'bad_request', `Máximo ${MAX_BOTONES} botones`);
    const botones = entrada
      .map((b) => ({
        nombre: String(b?.nombre || '').trim().slice(0, 60),
        comando: String(b?.comando || '').trim().slice(0, 200),
        producto: PRODUCTOS.includes(b?.producto) ? b.producto : 'General',
      }))
      .filter((b) => b.nombre && b.comando);
    await setConfig(CLAVE, JSON.stringify(botones));
    res.json({ botones });
  } catch (e) { next(e); }
});

export default router;

// Web Push del Tablero (ola 30/07): notificaciones del sistema con la app
// cerrada. Las claves VAPID se AUTOGENERAN en el primer uso y persisten en
// Configuracion (cero pasos manuales para Juan). El envío es fire-and-forget:
// jamás rompe la operación que lo dispara; las suscripciones muertas (410/404)
// se limpian solas.
import webpush from 'web-push';
import { prisma } from './prisma.js';
import { getConfig, setConfig } from './config.js';

// Catálogo EXTENSIBLE de tipos de notificación: agregar acá un tipo lo hace
// aparecer solo en la pantalla de preferencias de cada usuario.
export const TIPOS_NOTIFICACION = [
  { id: 'reuniones', label: 'Reuniones', desc: 'Invitaciones, reprogramaciones y cancelaciones de reuniones donde participás', defecto: true },
  { id: 'crm_lead_ganado', label: 'CRM: lead ganado', desc: 'Aviso cuando un lead del CRM pasa a ganado', defecto: false },
];

const CLAVE_PREFS = 'notificaciones_prefs'; // { [colabId]: { tipo: bool } }

async function leerTodasLasPrefs() {
  try { const raw = await getConfig(CLAVE_PREFS); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

export async function preferenciasDe(colaboradorId) {
  const todas = await leerTodasLasPrefs();
  const mias = todas[colaboradorId] || todas[String(colaboradorId)] || {};
  const out = {};
  for (const t of TIPOS_NOTIFICACION) out[t.id] = (t.id in mias) ? !!mias[t.id] : t.defecto;
  return out;
}

export async function guardarPreferencias(colaboradorId, prefs) {
  const todas = await leerTodasLasPrefs();
  const limpias = {};
  for (const t of TIPOS_NOTIFICACION) if (t.id in (prefs || {})) limpias[t.id] = !!prefs[t.id];
  todas[String(colaboradorId)] = { ...(todas[String(colaboradorId)] || {}), ...limpias };
  await setConfig(CLAVE_PREFS, JSON.stringify(todas));
  return preferenciasDe(colaboradorId);
}

let vapidListo = null;
export async function clavePublicaVapid() {
  if (!vapidListo) {
    let pub = await getConfig('push_vapid_publica');
    let priv = await getConfig('push_vapid_privada');
    if (!pub || !priv) {
      const par = webpush.generateVAPIDKeys();
      pub = par.publicKey; priv = par.privateKey;
      await setConfig('push_vapid_publica', pub);
      await setConfig('push_vapid_privada', priv);
    }
    webpush.setVapidDetails('mailto:cooptech@coopmorteros.coop', pub, priv);
    vapidListo = pub;
  }
  return vapidListo;
}

// payload: { titulo, cuerpo, url? } — tipo: id del catálogo (filtra por la
// preferencia de cada destinatario).
export async function notificarColaboradores(colaboradorIds, payload, tipo = 'reuniones') {
  try {
    let ids = [...new Set((colaboradorIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return;
    const filtrados = [];
    for (const id of ids) {
      const prefs = await preferenciasDe(id);
      if (prefs[tipo]) filtrados.push(id);
    }
    ids = filtrados;
    if (!ids.length) return;
    await clavePublicaVapid();
    const subs = await prisma.pushSuscripcion.findMany({ where: { colaboradorId: { in: ids } } });
    const cuerpo = JSON.stringify(payload);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.datos?.keys }, cuerpo);
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await prisma.pushSuscripcion.delete({ where: { id: s.id } }).catch(() => {});
        }
      }
    }));
  } catch { /* nunca romper la operación que notifica */ }
}

// Difusión a TODOS los que optaron por un tipo (p.ej. lead ganado).
export async function notificarSuscriptosA(tipo, payload, excluirId = null) {
  try {
    const subs = await prisma.pushSuscripcion.findMany({ select: { colaboradorId: true }, distinct: ['colaboradorId'] });
    const ids = subs.map(s2 => s2.colaboradorId).filter(id => id !== excluirId);
    await notificarColaboradores(ids, payload, tipo);
  } catch { /* fire-and-forget */ }
}

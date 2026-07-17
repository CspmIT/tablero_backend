// Cliente mínimo de Microsoft Graph para la casilla comercial (ola 2 de
// videollamadas). Autenticación client credentials (permisos de aplicación):
// nadie inicia sesión; el backend actúa con la app "Tablero Cooptech" de Entra ID.
//
// Variables de entorno (las provee el administrador de M365 — ver guía):
//   GRAPH_TENANT_ID      Id. de directorio (inquilino)
//   GRAPH_CLIENT_ID      Id. de aplicación (cliente)
//   GRAPH_CLIENT_SECRET  Valor del secreto (vence: agendar renovación)
//   GRAPH_CASILLA        Casilla comercial sobre la que se crean los eventos
//
// Desde el 14/07 las credenciales también pueden cargarse DESDE LA APP (solo
// manager, engranaje en el CRM): se guardan cifradas en Configuracion y tienen
// prioridad sobre las variables de entorno. Se registra además el VENCIMIENTO
// del secreto para avisar antes de que expire.
import { ApiError } from '../middleware/errorHandler.js';
import { getConfig, setConfig } from './config.js';

export const GRAPH_KEYS = {
  tenantId: 'graph_tenant_id',
  clientId: 'graph_client_id',
  clientSecret: 'graph_client_secret',
  casilla: 'graph_casilla',
  vence: 'graph_secret_vence',
};

const TZ = 'America/Argentina/Cordoba';
const LOGIN_URL = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';

// Resolución de credenciales: Configuracion (app) → variables de entorno.
export async function resolverGraphConfig() {
  const [tenantId, clientId, clientSecret, casilla, vence] = await Promise.all([
    getConfig(GRAPH_KEYS.tenantId), getConfig(GRAPH_KEYS.clientId),
    getConfig(GRAPH_KEYS.clientSecret), getConfig(GRAPH_KEYS.casilla),
    getConfig(GRAPH_KEYS.vence),
  ]);
  if (tenantId && clientId && clientSecret && casilla) {
    return { origen: 'db', tenantId, clientId, clientSecret, casilla, vence: vence || null };
  }
  if (process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID
    && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_CASILLA) {
    return {
      origen: 'env',
      tenantId: process.env.GRAPH_TENANT_ID,
      clientId: process.env.GRAPH_CLIENT_ID,
      clientSecret: process.env.GRAPH_CLIENT_SECRET,
      casilla: process.env.GRAPH_CASILLA,
      vence: process.env.GRAPH_SECRET_VENCE || null,
    };
  }
  return null;
}

export async function graphConfigurado() {
  return Boolean(await resolverGraphConfig());
}

export async function guardarGraphConfig({ tenantId, clientId, clientSecret, casilla, vence }) {
  await Promise.all([
    setConfig(GRAPH_KEYS.tenantId, tenantId), setConfig(GRAPH_KEYS.clientId, clientId),
    setConfig(GRAPH_KEYS.clientSecret, clientSecret), setConfig(GRAPH_KEYS.casilla, casilla),
    setConfig(GRAPH_KEYS.vence, vence || null),
  ]);
  tokenCache = { firma: null, token: null, vence: 0 };
}

export async function borrarGraphConfig() {
  await Promise.all(Object.values(GRAPH_KEYS).map((k) => setConfig(k, null)));
  tokenCache = { firma: null, token: null, vence: 0 };
}

// Días para el vencimiento del secreto (null si no está registrado).
export function diasParaVencer(vence) {
  if (!vence) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  return Math.round((new Date(vence) - new Date(hoy)) / 86400000);
}

// Caché del token en memoria, atado a la firma de las credenciales: si se
// cambian desde la app, el token viejo se descarta solo.
let tokenCache = { firma: null, token: null, vence: 0 };

async function obtenerToken(credenciales) {
  const cred = credenciales || await resolverGraphConfig();
  if (!cred) throw new ApiError(503, 'graph_no_configurado', 'La integración con Outlook no está configurada');
  const firma = `${cred.tenantId}|${cred.clientId}|${cred.clientSecret.slice(-6)}`;
  if (tokenCache.token && tokenCache.firma === firma && Date.now() < tokenCache.vence) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(LOGIN_URL(cred.tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new ApiError(502, 'graph_auth', `No se pudo autenticar contra Microsoft (${data?.error_description?.split('.')[0] || res.status})`);
  }
  tokenCache = { firma, token: data.access_token, vence: Date.now() + (Number(data.expires_in || 3600) - 120) * 1000 };
  return tokenCache.token;
}

export async function graphFetch(path, { method = 'GET', body, credenciales } = {}) {
  const token = await obtenerToken(credenciales);
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(502, 'graph_error', `Microsoft Graph: ${data?.error?.message || res.statusText}`);
  }
  return data;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Crea el evento en el calendario de la casilla comercial con reunión de Teams.
// Exchange envía las invitaciones automáticamente (el mail llega con el bloque
// estándar "Unirse / Id. de reunión / Código de acceso" que genera el tenant).
// Evento genérico: virtual (Teams) o presencial (con lugar), en la casilla
// indicada (comercial para clientes; el buzón del organizador para internas).
export async function crearEvento({ casilla: casillaParam, subject, cuerpo, fecha, horaInicio, horaFin, attendees = [], online = true, lugar = null }) {
  const cred = await resolverGraphConfig();
  if (!cred) throw new ApiError(503, 'graph_no_configurado', 'La integración con Outlook no está configurada');
  const casilla = encodeURIComponent(casillaParam || cred.casilla);
  const evento = await graphFetch(`/users/${casilla}/events`, {
    method: 'POST',
    body: {
      subject,
      body: { contentType: 'text', content: cuerpo || subject },
      start: { dateTime: `${fecha}T${horaInicio}:00`, timeZone: TZ },
      end: { dateTime: `${fecha}T${horaFin}:00`, timeZone: TZ },
      attendees,
      ...(lugar ? { location: { displayName: lugar } } : {}),
      ...(online ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
    },
  });
  return { evento, casillaUsada: casillaParam || cred.casilla };
}

// Reprogramación: PATCH del evento — Outlook envía solos los mails de
// "reunión actualizada" a todos los invitados y corrige sus calendarios.
export async function actualizarEvento({ casilla, eventId, subject, fecha, horaInicio, horaFin, attendees, lugar, online }) {
  const body = {};
  if (subject) body.subject = subject;
  if (fecha && horaInicio) body.start = { dateTime: `${fecha}T${horaInicio}:00`, timeZone: TZ };
  if (fecha && horaFin) body.end = { dateTime: `${fecha}T${horaFin}:00`, timeZone: TZ };
  if (Array.isArray(attendees)) body.attendees = attendees;
  if (lugar !== undefined) body.location = { displayName: lugar || '' };
  await graphFetch(`/users/${encodeURIComponent(casilla)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH', body,
  });
}

// Cancelación: DELETE del evento — Outlook envía las cancelaciones a todos.
export async function cancelarEvento({ casilla, eventId }) {
  await graphFetch(`/users/${encodeURIComponent(casilla)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE', esperarVacio: true,
  });
}

export function armarAttendees({ emailLead, contactoNombre, organizacion, emails = [] }) {
  return [
    emailLead ? { emailAddress: { address: emailLead, name: contactoNombre || organizacion || emailLead }, type: 'required' } : null,
    ...emails.filter(Boolean).map((address) => ({ emailAddress: { address }, type: 'required' })),
  ].filter(Boolean);
}

export async function crearEventoVideollamada({ organizacion, fecha, horaInicio, horaFin, notas, emailLead, contactoNombre, emailsColaboradores = [] }) {
  const attendees = armarAttendees({ emailLead, contactoNombre, organizacion, emails: emailsColaboradores });
  const { evento, casillaUsada } = await crearEvento({
    subject: `Videollamada Cooptech · ${organizacion}`,
    cuerpo: notas || `Videollamada con ${organizacion}.`,
    fecha, horaInicio, horaFin, attendees, online: true,
  });
  const casilla = encodeURIComponent(casillaUsada);

  // El joinUrl a veces tarda unos instantes en materializarse: un reintento corto.
  let joinUrl = evento?.onlineMeeting?.joinUrl || null;
  if (!joinUrl && evento?.id) {
    await dormir(1500);
    try {
      const releido = await graphFetch(`/users/${casilla}/events/${evento.id}?$select=onlineMeeting,webLink`);
      joinUrl = releido?.onlineMeeting?.joinUrl || null;
    } catch { /* si no aparece, el link igual viaja en la invitación */ }
  }

  return { id: evento.id, joinUrl, webLink: evento.webLink || null };
}

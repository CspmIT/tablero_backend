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
// Si falta alguna, graphConfigurado() da false y el flujo cae al .ics (ola 1).
import { ApiError } from '../middleware/errorHandler.js';

const TZ = 'America/Argentina/Cordoba';
const LOGIN_URL = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const GRAPH = 'https://graph.microsoft.com/v1.0';

export function graphConfigurado() {
  return Boolean(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID
    && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_CASILLA);
}

// Caché del token en memoria (dura ~1 h; renovamos 2 min antes de que venza).
let tokenCache = { token: null, vence: 0 };

async function obtenerToken() {
  if (tokenCache.token && Date.now() < tokenCache.vence) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID,
    client_secret: process.env.GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(LOGIN_URL(process.env.GRAPH_TENANT_ID), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new ApiError(502, 'graph_auth', `No se pudo autenticar contra Microsoft (${data?.error_description?.split('.')[0] || res.status})`);
  }
  tokenCache = { token: data.access_token, vence: Date.now() + (Number(data.expires_in || 3600) - 120) * 1000 };
  return tokenCache.token;
}

async function graphFetch(path, { method = 'GET', body } = {}) {
  const token = await obtenerToken();
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
export async function crearEventoVideollamada({ organizacion, fecha, horaInicio, horaFin, notas, emailLead, contactoNombre, emailsColaboradores = [] }) {
  const casilla = encodeURIComponent(process.env.GRAPH_CASILLA);
  const attendees = [
    emailLead ? { emailAddress: { address: emailLead, name: contactoNombre || organizacion }, type: 'required' } : null,
    ...emailsColaboradores.filter(Boolean).map((address) => ({ emailAddress: { address }, type: 'required' })),
  ].filter(Boolean);

  const evento = await graphFetch(`/users/${casilla}/events`, {
    method: 'POST',
    body: {
      subject: `Videollamada Cooptech · ${organizacion}`,
      body: { contentType: 'text', content: notas || `Videollamada con ${organizacion}.` },
      start: { dateTime: `${fecha}T${horaInicio}:00`, timeZone: TZ },
      end: { dateTime: `${fecha}T${horaFin}:00`, timeZone: TZ },
      attendees,
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    },
  });

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

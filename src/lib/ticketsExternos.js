// Tickets de sistemas externos (14/10 Reconecta, 15/10 Más Agua).
//
// Las cooperativas abren tickets de soporte en Reconecta o en Más Agua y
// entran al Inbox por routes/integracionTickets.js (un router por sistema,
// cada uno con su API key). Lo que el equipo hace acá con esos tickets
// (cambiar el estado, responder, adjuntar) se le avisa al sistema de origen
// para que la cooperativa lo vea. Best effort, igual que avisarEstadoMesa: el
// cambio local ya está hecho; si el sistema no responde, vuelve
// { ok:false, motivo } y el frontend lo muestra para reintentar.
//
// Variables de entorno, por sistema (<P> = RECONECTA | MASAGUA):
//   <P>_TICKETS_API_KEY  la que presenta el sistema al empujar tickets; una o
//                        varias separadas por coma. Sin ella, su entrada da 503.
//   <P>_TICKETS_URL      base de la entrada en el backend del sistema,
//                        p.ej. https://reconecta.cooptech.com.ar/api/tablero/tickets
//   <P>_TICKETS_TOKEN    Bearer que el sistema acepta ahí.
// Sin URL o token, no se le avisa nada (motivo 'sin_config').

// Catálogo de sistemas. La clave es el valor de Ticket.origen y el prefijo
// del externalId ("<clave>:<schema>:<id>"). Sumar uno acá requiere también el
// valor en el enum TicketOrigen (migración) y su montaje en app.js.
export const SISTEMAS = {
  reconecta: { label: 'Reconecta', area: 'Reconecta', env: 'RECONECTA' },
  masagua: { label: 'Más Agua', area: 'Más Agua', env: 'MASAGUA' },
};

export const apiKeysDe = (sistema) =>
  String(process.env[`${SISTEMAS[sistema].env}_TICKETS_API_KEY`] || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

const BASE = (sistema) => String(process.env[`${SISTEMAS[sistema].env}_TICKETS_URL`] || '').replace(/\/+$/, '');
const TOKEN = (sistema) => process.env[`${SISTEMAS[sistema].env}_TICKETS_TOKEN`];

// externalId = "<sistema>:<schema>:<id local en el sistema>"
export function refExterna(ticket) {
  const m = /^([a-z]+):([A-Za-z0-9_]+):(\d+)$/.exec(String(ticket?.externalId || ''));
  if (!m || !SISTEMAS[m[1]] || m[1] !== ticket.origen) return null;
  return { sistema: m[1], schema: m[2], id: Number(m[3]) };
}

export const esExterno = (t) => !!refExterna(t);

async function llamar(ticket, metodo, sufijo, body) {
  try {
    const ref = refExterna(ticket);
    if (!ref) return { ok: false, motivo: 'sin_referencia' };
    if (!BASE(ref.sistema) || !TOKEN(ref.sistema)) return { ok: false, motivo: 'sin_config' };
    const res = await fetch(`${BASE(ref.sistema)}/${encodeURIComponent(ref.schema)}/${ref.id}${sufijo}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${TOKEN(ref.sistema)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      // tableroId: el sistema verifica que su ticket local apunte a este.
      body: JSON.stringify({ tableroId: ticket.id, ...body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, motivo: `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message || 'sin_red' };
  }
}

export const avisarEstado = (ticket, estado) => llamar(ticket, 'PATCH', '', { estado });

export const avisarMensaje = (ticket, mensaje) => llamar(ticket, 'POST', '/mensajes', {
  externalId: mensaje.id,
  autor: mensaje.autor ? `${mensaje.autor} (Cooptech)` : 'Cooptech',
  texto: mensaje.texto,
  createdAt: mensaje.createdAt,
});

export const avisarAdjuntos = (ticket, archivos) => llamar(ticket, 'POST', '/adjuntos', {
  adjuntos: archivos.map((a) => ({ key: a.key, nombre: a.nombre, mime: a.mime, tamano: a.tamano })),
});

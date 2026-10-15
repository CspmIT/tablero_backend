// Tickets de Reconecta (14/10) — vuelta hacia Reconecta.
//
// Los tickets que abre una cooperativa en Reconecta entran por
// routes/integracionReconecta.js. Lo que el equipo hace acá con esos tickets
// (cambiar el estado, responder, adjuntar) se le avisa a Reconecta para que la
// cooperativa lo vea. Best effort, igual que avisarEstadoMesa: el cambio local
// ya está hecho; si Reconecta no responde, vuelve { ok:false, motivo } y el
// frontend lo muestra para reintentar.
//
// Variables de entorno:
//   RECONECTA_TICKETS_URL    base de la entrada en el backend de Reconecta,
//                            p.ej. https://reconecta.cooptech.com.ar/api/tablero/tickets
//   RECONECTA_TICKETS_TOKEN  Bearer que Reconecta acepta ahí (su variable del
//                            mismo nombre).
// Sin las dos, no se avisa nada (motivo 'sin_config').

const BASE = () => String(process.env.RECONECTA_TICKETS_URL || '').replace(/\/+$/, '');
const TOKEN = () => process.env.RECONECTA_TICKETS_TOKEN;

// externalId = "reconecta:<schema>:<id local en Reconecta>"
export function refReconecta(ticket) {
  const m = /^reconecta:([A-Za-z0-9_]+):(\d+)$/.exec(String(ticket?.externalId || ''));
  return m ? { schema: m[1], id: Number(m[2]) } : null;
}

export const esDeReconecta = (t) => t?.origen === 'reconecta' && !!refReconecta(t);

async function llamar(ticket, metodo, sufijo, body) {
  try {
    const ref = refReconecta(ticket);
    if (!ref) return { ok: false, motivo: 'sin_referencia' };
    if (!BASE() || !TOKEN()) return { ok: false, motivo: 'sin_config' };
    const res = await fetch(`${BASE()}/${encodeURIComponent(ref.schema)}/${ref.id}${sufijo}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      // tableroId: Reconecta verifica que el ticket local apunte a este.
      body: JSON.stringify({ tableroId: ticket.id, ...body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, motivo: `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message || 'sin_red' };
  }
}

export const avisarEstadoReconecta = (ticket, estado) => llamar(ticket, 'PATCH', '', { estado });

export const avisarMensajeReconecta = (ticket, mensaje) => llamar(ticket, 'POST', '/mensajes', {
  externalId: mensaje.id,
  autor: mensaje.autor ? `${mensaje.autor} (Cooptech)` : 'Cooptech',
  texto: mensaje.texto,
  createdAt: mensaje.createdAt,
});

export const avisarAdjuntosReconecta = (ticket, archivos) => llamar(ticket, 'POST', '/adjuntos', {
  adjuntos: archivos.map((a) => ({ key: a.key, nombre: a.nombre, mime: a.mime, tamano: a.tamano })),
});

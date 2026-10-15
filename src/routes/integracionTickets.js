// Tickets desde sistemas externos (14/10 Reconecta, 15/10 Más Agua) — entrada
// para sus backends.
//
// Las cooperativas abren tickets de soporte en Reconecta o en Más Agua y el
// equipo los trabaja acá, en el Inbox (origen=<sistema>, cooperativa=<schema>).
// El sistema los EMPUJA en el momento (alta, mensajes, adjuntos,
// cierre/reapertura) y reintenta cada 5 minutos lo que no llegó, así que todo
// es idempotente:
//   - ticket   → externalId "<sistema>:<schema>:<id>"
//   - mensaje  → externalId "<sistema>:<schema>:m<id>"
//   - adjunto  → key de MinIO (Archivo.key es único); el binario lo sube el
//                sistema directo al bucket del tablero.
// Lo que hace el equipo acá vuelve al sistema por lib/ticketsExternos.js.
//
// Cada pedido trae `cooperativa` (schema del sistema: identifica y autoriza) y
// `cooperativaNombre` (cooptech.clients.name vía client_products, resuelto por
// el sistema). El nombre se guarda y se refresca en cada pedido: muchas coops
// usan cada sistema y en el Inbox tienen que distinguirse a simple vista.
//
// Mismo esquema que catalogoFirmwares.js: API key propia POR SISTEMA, montado
// ANTES de `authenticate`. Con la key de un sistema solo se tocan tickets de
// ese origen y de la cooperativa que se declara en el body: no abre el resto
// del Inbox ni los tickets del otro sistema.
// Variables: <P>_TICKETS_API_KEY (ver lib/ticketsExternos.js).
import crypto from 'crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { notificarColaboradores, notificarSuscriptosA } from '../lib/push.js';
import { SISTEMAS, apiKeysDe } from '../lib/ticketsExternos.js';

const TIPOS = ['Incidente', 'Solicitud'];
const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente'];
const SCHEMA_RE = /^[A-Za-z0-9_]{1,64}$/;

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const coincide = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;

const nombreDe = (b) => limpiar(b?.cooperativaNombre);
// Para avisos y autores: el nombre si lo hay, si no el schema.
export const etiquetaCoop = (t) => t.cooperativaNombre || t.cooperativa;

// Aviso a quien tiene asignado el ticket; sin asignado, a los suscriptos.
const avisarEquipo = (t, aviso) => {
  if (t.asignadoAId) notificarColaboradores([t.asignadoAId], aviso, 'ticket_mensaje');
  else notificarSuscriptosA('ticket_mensaje', aviso);
};

/**
 * Router de entrada para un sistema del catálogo SISTEMAS.
 * @param {'reconecta'|'masagua'} sistema
 */
export function integracionTicketsRouter(sistema) {
  const { label, area } = SISTEMAS[sistema];
  const router = Router();

  router.use((req, res, next) => {
    const permitidas = apiKeysDe(sistema);
    if (!permitidas.length) {
      return next(new ApiError(503, 'not_configured', `La entrada de tickets de ${label} no está habilitada en este servidor`));
    }
    const header = req.headers.authorization || '';
    const clave = req.headers['x-api-key'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!clave || !permitidas.some((k) => coincide(k, clave))) {
      return next(new ApiError(401, 'unauthorized', 'API key inválida o ausente'));
    }
    next();
  });

  const cooperativaDe = (b) => {
    const c = String(b?.cooperativa || '');
    if (!SCHEMA_RE.test(c)) throw new ApiError(400, 'bad_request', `Falta la cooperativa (schema de ${label})`);
    return c;
  };

  // El ticket tiene que ser de este sistema y de la cooperativa que llama. Si
  // el nombre llegó distinto (alta sin client_products, coop renombrada), se corrige.
  async function ticketDe(req) {
    const cooperativa = cooperativaDe(req.body);
    const t = await prisma.ticket.findUnique({ where: { id: Number(req.params.id) } });
    if (!t || t.origen !== sistema || t.cooperativa !== cooperativa) {
      throw new ApiError(404, 'not_found', 'Ticket no encontrado');
    }
    const nombre = nombreDe(req.body);
    if (nombre && nombre !== t.cooperativaNombre) {
      return prisma.ticket.update({ where: { id: t.id }, data: { cooperativaNombre: nombre } });
    }
    return t;
  }

  // POST / — alta. Si ya existe (reintento del sistema), devuelve el mismo.
  router.post('/', async (req, res, next) => {
    try {
      const b = req.body || {};
      const cooperativa = cooperativaDe(b);
      const ref = String(b.externalId || '');
      if (!new RegExp(`^${cooperativa}:\\d+$`).test(ref)) {
        throw new ApiError(400, 'bad_request', 'externalId debe ser "<cooperativa>:<id>"');
      }
      const externalId = `${sistema}:${ref}`;
      const existente = await prisma.ticket.findUnique({ where: { externalId } });
      if (existente) {
        const nombre = nombreDe(b);
        if (nombre && nombre !== existente.cooperativaNombre) {
          await prisma.ticket.update({ where: { id: existente.id }, data: { cooperativaNombre: nombre } });
        }
        return res.json({ id: existente.id, estado: existente.estado });
      }

      const titulo = limpiar(b.titulo);
      const descripcion = String(b.descripcion || '').trim();
      if (!titulo) throw new ApiError(400, 'bad_request', 'Falta el título');
      if (!descripcion) throw new ApiError(400, 'bad_request', 'Falta la descripción');

      const t = await prisma.ticket.create({
        data: {
          titulo,
          descripcion,
          sector: limpiar(b.sector),
          tipo: TIPOS.includes(b.tipo) ? b.tipo : 'Incidente',
          prioridad: PRIORIDADES.includes(b.prioridad) ? b.prioridad : 'Media',
          area,
          copiarA: String(b.copiarA || '').trim() || null,
          origen: sistema,
          externalId,
          cooperativa,
          cooperativaNombre: nombreDe(b),
          // Quién lo abrió en la cooperativa: nombre y mail para poder contactarlo.
          solicitante: limpiar([b.solicitante, b.solicitanteEmail && `<${b.solicitanteEmail}>`].filter(Boolean).join(' ')),
          ocurridoAt: b.createdAt ? new Date(b.createdAt) : null,
        },
      });
      notificarSuscriptosA('ticket_nuevo', {
        titulo: `🎫 Ticket nuevo desde ${label}`,
        cuerpo: `${t.titulo} — ${etiquetaCoop(t)}`,
        url: '/',
      });
      res.status(201).json({ id: t.id, estado: t.estado });
    } catch (e) { next(e); }
  });

  // POST /:id/adjuntos { cooperativa, adjuntos: [{ key, nombre, mime, tamano }] }
  router.post('/:id/adjuntos', async (req, res, next) => {
    try {
      const t = await ticketDe(req);
      const adjuntos = Array.isArray(req.body?.adjuntos) ? req.body.adjuntos : [];
      if (!adjuntos.length || adjuntos.length > 10) throw new ApiError(400, 'bad_request', 'Mandá entre 1 y 10 adjuntos');
      let creados = 0;
      for (const a of adjuntos) {
        const key = limpiar(a?.key, 191);
        if (!key) throw new ApiError(400, 'bad_request', 'Hay un adjunto sin key');
        const ya = await prisma.archivo.findUnique({ where: { key } });
        if (ya) continue;
        await prisma.archivo.create({
          data: {
            key,
            nombre: limpiar(a.nombre) || key,
            mime: limpiar(a.mime),
            tamano: Number.isFinite(Number(a.tamano)) ? Number(a.tamano) : null,
            contexto: 'ticket',
            url: `ticket:${t.id}`,
          },
        });
        creados += 1;
      }
      res.status(201).json({ ok: true, creados });
    } catch (e) { next(e); }
  });

  // POST /:id/mensajes { cooperativa, externalId, autor, texto, createdAt }
  router.post('/:id/mensajes', async (req, res, next) => {
    try {
      const t = await ticketDe(req);
      const b = req.body || {};
      const texto = String(b.texto || '').trim();
      if (!texto) throw new ApiError(400, 'bad_request', 'Falta el texto');
      if (!new RegExp(`^${t.cooperativa}:m\\d+$`).test(String(b.externalId || ''))) {
        throw new ApiError(400, 'bad_request', 'externalId debe ser "<cooperativa>:m<id>"');
      }
      const externalId = `${sistema}:${b.externalId}`;
      const existente = await prisma.ticketMensaje.findUnique({ where: { externalId } });
      if (existente) return res.json({ id: existente.id });

      const m = await prisma.ticketMensaje.create({
        data: {
          ticketId: t.id,
          autorId: null,
          autor: `${limpiar(b.autor, 120) || 'Cooperativa'} (${etiquetaCoop(t)})`,
          texto,
          externalId,
          ...(b.createdAt ? { createdAt: new Date(b.createdAt) } : {}),
        },
      });
      await prisma.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
      avisarEquipo(t, { titulo: `💬 #${t.id} · respuesta de ${etiquetaCoop(t)}`, cuerpo: texto.slice(0, 140), url: '/' });
      res.status(201).json({ id: m.id });
    } catch (e) { next(e); }
  });

  // PATCH /:id { cooperativa, estado } — la cooperativa solo cierra o reabre
  // (la reapertura llega antes como mensaje con el motivo).
  router.patch('/:id', async (req, res, next) => {
    try {
      const t = await ticketDe(req);
      const estado = req.body?.estado;
      if (!['cerrado', 'abierto'].includes(estado)) {
        throw new ApiError(400, 'bad_request', `Desde ${label} solo se puede cerrar o reabrir`);
      }
      const data = { estado };
      if (estado === 'cerrado' && !t.cerradoAt) data.cerradoAt = new Date();
      if (estado === 'abierto') { data.resueltoAt = null; data.cerradoAt = null; }
      const actualizado = await prisma.ticket.update({ where: { id: t.id }, data });
      if (estado === 'abierto' && t.estado !== 'abierto') {
        avisarEquipo(t, { titulo: `↩️ #${t.id} reabierto por ${etiquetaCoop(t)}`, cuerpo: t.titulo, url: '/' });
      }
      res.json({ id: actualizado.id, estado: actualizado.estado });
    } catch (e) { next(e); }
  });

  return router;
}

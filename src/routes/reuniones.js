// Ola de reuniones — ciclo de vida completo con Outlook y grilla sincronizados.
// Internas (Mi mes): el evento nace en el buzón DEL ORGANIZADOR (virtual con
// Teams o presencial con sala). Clientes (CRM): nacen en /leads/:id/videollamada
// pero se gestionan también acá. Reprogramar/cancelar hace el PATCH/DELETE en
// Graph (Outlook avisa solo a todos) y muda/quita los ítems de la grilla de
// cada involucrado (marcados con reunionId) en una transacción.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { graphConfigurado, crearEvento, actualizarEvento, cancelarEvento, armarAttendees } from '../lib/graph.js';

const router = Router();

export function textoItemReunion(r) {
  const rango = `${r.horaInicio}–${r.horaFin}`;
  const lugar = r.modalidad === 'presencial' && r.lugar ? ` · ${r.lugar}` : '';
  return `${r.tipo === 'cliente' ? 'Videollamada' : 'Reunión:'} ${r.titulo} (${rango})${lugar}`;
}

export async function agregarItemsGrilla(tx, ids, fechaD, item) {
  for (const colaboradorId of ids) {
    const existente = await tx.grillaEntrada.findUnique({
      where: { colaboradorId_fecha: { colaboradorId, fecha: fechaD } },
    });
    const items = Array.isArray(existente?.items) ? [...existente.items] : [];
    if (!items.some(it => it && it.reunionId === item.reunionId)) items.push(item);
    await tx.grillaEntrada.upsert({
      where: { colaboradorId_fecha: { colaboradorId, fecha: fechaD } },
      update: { items },
      create: { colaboradorId, fecha: fechaD, items },
    });
  }
}

export async function quitarItemsGrilla(tx, ids, fechaD, reunionId) {
  for (const colaboradorId of ids) {
    const existente = await tx.grillaEntrada.findUnique({
      where: { colaboradorId_fecha: { colaboradorId, fecha: fechaD } },
    });
    if (!existente) continue;
    const items = (Array.isArray(existente.items) ? existente.items : [])
      .filter(it => !(it && it.reunionId === reunionId));
    await tx.grillaEntrada.update({
      where: { colaboradorId_fecha: { colaboradorId, fecha: fechaD } },
      data: { items },
    });
  }
}

function validarBase({ fecha, horaInicio, horaFin }) {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw new ApiError(400, 'bad_request', 'Falta la fecha (YYYY-MM-DD)');
  if (!horaInicio || !horaFin) throw new ApiError(400, 'bad_request', 'Faltan hora de inicio y fin');
  if (String(horaFin) <= String(horaInicio)) throw new ApiError(400, 'bad_request', 'La hora de fin debe ser posterior a la de inicio');
}

function puedeGestionar(req, r) {
  return req.colaborador?.tipo === 'manager' || req.colaborador?.id === r.organizadorId;
}

async function emailsDe(ids) {
  const cols = await prisma.colaborador.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, nombre: true } });
  return cols;
}

// GET /reuniones?desde=YYYY-MM-DD[&todas=1] → activas donde participo (o todas, manager)
router.get('/', async (req, res, next) => {
  try {
    const desde = req.query.desde && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde)
      ? new Date(req.query.desde + 'T00:00:00Z') : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const todas = req.query.todas && req.colaborador?.tipo === 'manager';
    const filas = await prisma.reunion.findMany({
      where: { estado: 'activa', fecha: { gte: desde } },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
      take: 100,
    });
    const mias = todas ? filas : filas.filter(r =>
      (Array.isArray(r.colaboradoresIds) ? r.colaboradoresIds : []).includes(req.colaborador?.id));
    res.json({ reuniones: mias, puedoGestionar: Object.fromEntries(mias.map(r => [r.id, puedeGestionar(req, r)])) });
  } catch (e) { next(e); }
});

// POST /reuniones — reunión INTERNA desde Mi mes.
// { titulo, fecha, horaInicio, horaFin, modalidad, lugar?, colaboradoresIds[], notas? }
router.post('/', async (req, res, next) => {
  try {
    const { titulo, fecha, horaInicio, horaFin, notas } = req.body || {};
    const modalidad = req.body?.modalidad === 'presencial' ? 'presencial' : 'virtual';
    const lugar = modalidad === 'presencial' ? String(req.body?.lugar || '').trim() : null;
    if (!String(titulo || '').trim()) throw new ApiError(400, 'bad_request', 'Falta el título');
    validarBase({ fecha, horaInicio, horaFin });
    if (modalidad === 'presencial' && !lugar) throw new ApiError(400, 'bad_request', 'Indicá el lugar de la reunión presencial');

    // El organizador va SIEMPRE incluido (lección de campo del 16/07).
    const ids = [...new Set([...(Array.isArray(req.body?.colaboradoresIds) ? req.body.colaboradoresIds : []).map(Number), req.colaborador.id].filter(Boolean))];
    const tags = (Array.isArray(req.body?.tags) ? req.body.tags : [])
      .map(t => String(t).trim()).filter(Boolean).slice(0, 6);

    // Outlook: evento en el buzón del ORGANIZADOR; invitados = los demás.
    let graphInfo = null, graphError = null;
    if (await graphConfigurado()) {
      try {
        const cols = await emailsDe(ids);
        const organizador = cols.find(c => c.id === req.colaborador.id);
        if (!organizador?.email) throw new ApiError(400, 'bad_request', 'Tu ficha no tiene email cargado (Equipo): necesario para crear el evento en tu Outlook');
        const attendees = armarAttendees({ emails: cols.filter(c => c.id !== req.colaborador.id).map(c => c.email) });
        const { evento, casillaUsada } = await crearEvento({
          casilla: organizador.email,
          subject: `Reunión Cooptech · ${String(titulo).trim()}`,
          cuerpo: [notas, lugar ? `Lugar: ${lugar}` : null].filter(Boolean).join('\n') || String(titulo).trim(),
          fecha: String(fecha), horaInicio, horaFin, attendees,
          online: modalidad === 'virtual', lugar,
        });
        graphInfo = { id: evento.id, casilla: casillaUsada, joinUrl: evento?.onlineMeeting?.joinUrl || null };
      } catch (e) { graphError = e.message || 'Error al crear el evento en Outlook'; }
    }

    const fechaD = new Date(String(fecha) + 'T00:00:00Z');
    const reunion = await prisma.$transaction(async (tx) => {
      const r = await tx.reunion.create({
        data: {
          tipo: 'interna', titulo: String(titulo).trim(),
          fecha: fechaD, horaInicio, horaFin, modalidad, lugar,
          organizadorId: req.colaborador.id,
          colaboradoresIds: ids,
          tags: tags.length ? tags : null,
          graphEventId: graphInfo?.id || null,
          casilla: graphInfo?.casilla || null,
          joinUrl: graphInfo?.joinUrl || null,
        },
      });
      await agregarItemsGrilla(tx, ids, fechaD, {
        text: textoItemReunion(r), wip: false, reunionId: r.id,
        ...(tags.length ? { tags } : {}),
        ...(graphInfo?.joinUrl ? { link: graphInfo.joinUrl } : {}),
      });
      return r;
    });
    res.status(201).json({ reunion, graphError });
  } catch (e) { next(e); }
});

// PATCH /reuniones/:id — reprogramar: fecha/hora/participantes/lugar/título.
router.patch('/:id', async (req, res, next) => {
  try {
    const r = await prisma.reunion.findUnique({ where: { id: Number(req.params.id) } });
    if (!r) throw new ApiError(404, 'not_found', 'Reunión inexistente');
    if (r.estado === 'cancelada') throw new ApiError(400, 'bad_request', 'La reunión está cancelada');
    if (!puedeGestionar(req, r)) throw new ApiError(403, 'forbidden', 'Solo el organizador o un manager pueden gestionarla');

    const fecha = req.body?.fecha || r.fecha.toISOString().slice(0, 10);
    const horaInicio = req.body?.horaInicio || r.horaInicio;
    const horaFin = req.body?.horaFin || r.horaFin;
    validarBase({ fecha, horaInicio, horaFin });
    const titulo = String(req.body?.titulo || r.titulo).trim();
    const lugar = r.modalidad === 'presencial' ? String(req.body?.lugar ?? r.lugar ?? '').trim() : r.lugar;
    const idsViejos = Array.isArray(r.colaboradoresIds) ? r.colaboradoresIds.map(Number) : [];
    const idsNuevos = req.body?.colaboradoresIds
      ? [...new Set([...(req.body.colaboradoresIds || []).map(Number), r.organizadorId].filter(Boolean))]
      : idsViejos;
    const tags = req.body?.tags !== undefined
      ? (Array.isArray(req.body.tags) ? req.body.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6) : [])
      : (Array.isArray(r.tags) ? r.tags : []);

    // Outlook primero: si el PATCH falla, no tocamos nada interno.
    let graphError = null;
    if (r.graphEventId && r.casilla) {
      try {
        const cols = await emailsDe(idsNuevos);
        let attendees = armarAttendees({ emails: cols.filter(c => c.id !== r.organizadorId).map(c => c.email) });
        if (r.tipo === 'cliente' && r.leadId) {
          const lead = await prisma.lead.findUnique({ where: { id: r.leadId }, select: { email: true, contactoNombre: true, organizacion: true } });
          if (lead?.email) attendees = armarAttendees({ emailLead: lead.email, contactoNombre: lead.contactoNombre, organizacion: lead.organizacion, emails: cols.map(c => c.email) });
        }
        await actualizarEvento({
          casilla: r.casilla, eventId: r.graphEventId,
          subject: r.tipo === 'cliente' ? undefined : `Reunión Cooptech · ${titulo}`,
          fecha, horaInicio, horaFin, attendees,
          ...(r.modalidad === 'presencial' ? { lugar } : {}),
        });
      } catch (e) {
        throw new ApiError(502, 'graph_error', `No se pudo actualizar el evento en Outlook (${e.message}). No se cambió nada: reintentá o gestionalo desde Outlook.`);
      }
    }

    const fechaVieja = new Date(r.fecha.toISOString().slice(0, 10) + 'T00:00:00Z');
    const fechaNueva = new Date(String(fecha) + 'T00:00:00Z');
    const actualizado = await prisma.$transaction(async (tx) => {
      await quitarItemsGrilla(tx, idsViejos, fechaVieja, r.id);
      const nuevo = await tx.reunion.update({
        where: { id: r.id },
        data: { titulo, fecha: fechaNueva, horaInicio, horaFin, lugar, colaboradoresIds: idsNuevos, tags: tags.length ? tags : null },
      });
      await agregarItemsGrilla(tx, idsNuevos, fechaNueva, {
        text: textoItemReunion(nuevo), wip: false, reunionId: nuevo.id,
        ...(tags.length ? { tags } : {}),
        ...(nuevo.joinUrl ? { link: nuevo.joinUrl } : {}),
      });
      if (r.crmActividadId) {
        await tx.crmActividad.update({
          where: { id: r.crmActividadId },
          data: { fecha: fechaNueva, notas: `Videollamada ${horaInicio}–${horaFin}${nuevo.joinUrl ? ` · Teams: ${nuevo.joinUrl}` : ''} (reprogramada)` },
        });
      }
      return nuevo;
    });
    res.json({ reunion: actualizado, graphError });
  } catch (e) { next(e); }
});

// DELETE /reuniones/:id — cancelar: Outlook avisa a todos, la grilla se limpia,
// la actividad CRM queda marcada (no cuenta en métricas).
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await prisma.reunion.findUnique({ where: { id: Number(req.params.id) } });
    if (!r) throw new ApiError(404, 'not_found', 'Reunión inexistente');
    if (!puedeGestionar(req, r)) throw new ApiError(403, 'forbidden', 'Solo el organizador o un manager pueden cancelarla');

    let graphError = null;
    if (r.graphEventId && r.casilla) {
      try { await cancelarEvento({ casilla: r.casilla, eventId: r.graphEventId }); }
      catch (e) { graphError = `El evento de Outlook no pudo cancelarse (${e.message}): cancelalo manualmente desde el calendario.`; }
    }

    const ids = Array.isArray(r.colaboradoresIds) ? r.colaboradoresIds.map(Number) : [];
    const fechaD = new Date(r.fecha.toISOString().slice(0, 10) + 'T00:00:00Z');
    await prisma.$transaction(async (tx) => {
      await quitarItemsGrilla(tx, ids, fechaD, r.id);
      await tx.reunion.update({ where: { id: r.id }, data: { estado: 'cancelada' } });
      if (r.crmActividadId) {
        await tx.crmActividad.update({ where: { id: r.crmActividadId }, data: { cancelada: true } });
      }
    });
    res.json({ ok: true, graphError });
  } catch (e) { next(e); }
});

export default router;

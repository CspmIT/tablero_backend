// Ola de reuniones — ciclo de vida completo con Outlook y grilla sincronizados.
// Internas (Mi mes): el evento nace en el buzón DEL ORGANIZADOR (virtual con
// Teams o presencial con sala). Clientes (CRM): nacen en /leads/:id/videollamada
// pero se gestionan también acá. Reprogramar/cancelar hace el PATCH/DELETE en
// Graph (Outlook avisa solo a todos) y muda/quita los ítems de la grilla de
// cada involucrado (marcados con reunionId) en una transacción.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { graphConfigurado, crearEvento, actualizarEvento, cancelarEvento, armarAttendees, responderInvitacion, listarCalendario, obtenerAsistentesEvento, obtenerRespuestasEvento } from '../lib/graph.js';
import { notificarColaboradores } from '../lib/push.js';

const router = Router();

export function horasEntre(hi, hf) {
  const [h1, m1] = String(hi).split(':').map(Number);
  const [h2, m2] = String(hf).split(':').map(Number);
  const d = (h2 * 60 + m2 - h1 * 60 - m1) / 60;
  return d > 0 ? Math.round(d * 100) / 100 : null;
}

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
    const conMiRespuesta = mias.map(r => ({
      ...r,
      miRespuesta: r.organizadorId === req.colaborador?.id
        ? 'organizador'
        : ((r.respuestas && r.respuestas[String(req.colaborador?.id)]) || (r.respuestas && r.respuestas[req.colaborador?.id]) || null),
    }));
    res.json({ reuniones: conMiRespuesta, puedoGestionar: Object.fromEntries(mias.map(r => [r.id, puedeGestionar(req, r)])) });
  } catch (e) { next(e); }
});

// POST /reuniones — reunión INTERNA desde Mi mes.
// { titulo, fecha, horaInicio, horaFin, modalidad, lugar?, colaboradoresIds[], notas? }
router.post('/', async (req, res, next) => {
  try {
    const emailsExternos = (Array.isArray(req.body?.emailsExternos) ? req.body.emailsExternos : [])
      .map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 10);
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
    if (!tags.length) throw new ApiError(400, 'bad_request', 'Agregá al menos una etiqueta (proyecto/tema): el ítem de grilla nace etiquetado');

    // Outlook: evento en el buzón del ORGANIZADOR; invitados = los demás.
    let graphInfo = null, graphError = null;
    if (await graphConfigurado()) {
      try {
        const cols = await emailsDe(ids);
        const organizador = cols.find(c => c.id === req.colaborador.id);
        if (!organizador?.email) throw new ApiError(400, 'bad_request', 'Tu ficha no tiene email cargado (Equipo): necesario para crear el evento en tu Outlook');
        const attendees = armarAttendees({ emails: [...(cols.filter(c => c.id !== req.colaborador.id).map(c => c.email)), ...emailsExternos] });
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
          organizadorId: req.colaborador.id, emailsExternos,
          colaboradoresIds: ids,
          tags: tags.length ? tags : null,
          graphEventId: graphInfo?.id || null,
          casilla: graphInfo?.casilla || null,
          joinUrl: graphInfo?.joinUrl || null,
        },
      });
      await agregarItemsGrilla(tx, ids, fechaD, {
        text: textoItemReunion(r), wip: false, reunionId: r.id,
        horas: horasEntre(horaInicio, horaFin), // la duración completa las horas de la tarea
        ...(tags.length ? { tags } : {}),
        ...(graphInfo?.joinUrl ? { link: graphInfo.joinUrl } : {}),
      });
      return r;
    });
    notificarColaboradores(ids.filter(i => i !== req.colaborador.id), {
      titulo: 'Invitación a reunión',
      cuerpo: `${reunion.titulo} · ${String(fecha).split('-').reverse().join('/')} ${horaInicio}–${horaFin}${lugar ? ' · ' + lugar : ''}`,
      url: '/',
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
    const emailsExternos = req.body?.emailsExternos !== undefined
      ? (Array.isArray(req.body.emailsExternos) ? req.body.emailsExternos : [])
        .map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 10)
      : (Array.isArray(r.emailsExternos) ? r.emailsExternos : []);
    const tags = req.body?.tags !== undefined
      ? (Array.isArray(req.body.tags) ? req.body.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6) : [])
      : (Array.isArray(r.tags) ? r.tags : []);
    if (r.tipo === 'interna' && !tags.length) throw new ApiError(400, 'bad_request', 'La reunión necesita al menos una etiqueta');

    // Outlook primero: si el PATCH falla, no tocamos nada interno.
    let graphError = null;
    if (r.graphEventId && r.casilla) {
      try {
        const cols = await emailsDe(idsNuevos);
        // PRESERVAR EXTERNOS (fix 04/08, caso Carola): Graph reemplaza la
        // lista de asistentes al editar, y a los quitados les manda una
        // CANCELACIÓN. Leemos los asistentes actuales del evento y
        // conservamos a todo el que NO sea colaborador interno (invitados a
        // mano en Outlook, mails del cliente, etc.).
        const actuales = await obtenerAsistentesEvento({ casilla: r.casilla, eventId: r.graphEventId });
        const todosColabs = new Set((await prisma.colaborador.findMany({ select: { email: true } }))
          .map(c => String(c.email || '').toLowerCase()).filter(Boolean));
        const casillaLc = String(decodeURIComponent(r.casilla) || '').toLowerCase();
        const externosPreservados = actuales.filter(e => !todosColabs.has(e) && e !== casillaLc);
        const externosFinal = [...new Set([...emailsExternos, ...externosPreservados])];
        let attendees = armarAttendees({ emails: [...cols.filter(c => c.id !== r.organizadorId).map(c => c.email), ...externosFinal] });
        if (r.tipo === 'cliente' && r.leadId) {
          const lead = await prisma.lead.findUnique({ where: { id: r.leadId }, select: { email: true, contactoNombre: true, organizacion: true } });
          // Los externos también se preservan en reuniones de cliente (el
          // lead va como emailLead, así que se lo excluye para no duplicarlo).
          if (lead?.email) attendees = armarAttendees({ emailLead: lead.email, contactoNombre: lead.contactoNombre, organizacion: lead.organizacion, emails: [...cols.map(c => c.email), ...externosFinal.filter(e => e !== String(lead.email).toLowerCase())] });
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
        // Al reprogramar, las respuestas se reinician (como en Outlook): la
        // fecha nueva vuelve a preguntar a todos.
        data: { titulo, fecha: fechaNueva, horaInicio, horaFin, lugar, colaboradoresIds: idsNuevos, tags: tags.length ? tags : null, respuestas: {}, emailsExternos },
      });
      await agregarItemsGrilla(tx, idsNuevos, fechaNueva, {
        text: textoItemReunion(nuevo), wip: false, reunionId: nuevo.id,
        horas: horasEntre(horaInicio, horaFin),
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
    notificarColaboradores(idsNuevos.filter(i => i !== req.colaborador?.id), {
      titulo: 'Reunión reprogramada',
      cuerpo: `${actualizado.titulo} · ahora ${fecha.split('-').reverse().join('/')} ${horaInicio}–${horaFin}`,
      url: '/',
    });
    res.json({ reunion: actualizado, graphError });
  } catch (e) { next(e); }
});

// POST /reuniones/:id/respuesta { respuesta: 'aceptada'|'rechazada'|'provisional' }
// El invitado responde desde la app: queda registrado en la Reunión, impacta
// su grilla (rechazar quita el ítem; volver a aceptar lo restituye) y —si
// Outlook está configurado— responde también la invitación en su buzón
// (best-effort: el registro interno vale aunque Graph falle).
router.post('/:id/respuesta', async (req, res, next) => {
  try {
    const r = await prisma.reunion.findUnique({ where: { id: Number(req.params.id) } });
    if (!r) throw new ApiError(404, 'not_found', 'Reunión inexistente');
    if (r.estado === 'cancelada') throw new ApiError(400, 'bad_request', 'La reunión está cancelada');
    const yo = req.colaborador?.id;
    const ids = Array.isArray(r.colaboradoresIds) ? r.colaboradoresIds.map(Number) : [];
    if (!ids.includes(yo)) throw new ApiError(403, 'forbidden', 'No estás invitado a esta reunión');
    if (yo === r.organizadorId) throw new ApiError(400, 'bad_request', 'El organizador no responde su propia reunión');
    const respuesta = String(req.body?.respuesta || '');
    if (!['aceptada', 'rechazada', 'provisional'].includes(respuesta)) {
      throw new ApiError(400, 'bad_request', 'Respuesta inválida (aceptada | rechazada | provisional)');
    }

    const fechaD = new Date(r.fecha.toISOString().slice(0, 10) + 'T00:00:00Z');
    await prisma.$transaction(async (tx) => {
      const respuestas = (r.respuestas && typeof r.respuestas === 'object') ? { ...r.respuestas } : {};
      respuestas[yo] = respuesta;
      await tx.reunion.update({ where: { id: r.id }, data: { respuestas } });
      if (respuesta === 'rechazada') {
        await quitarItemsGrilla(tx, [yo], fechaD, r.id);
      } else {
        // Aceptar/provisional restituye el ítem si antes había rechazado.
        await agregarItemsGrilla(tx, [yo], fechaD, {
          text: textoItemReunion(r), wip: false, reunionId: r.id,
          horas: horasEntre(r.horaInicio, r.horaFin),
          ...(Array.isArray(r.tags) && r.tags.length ? { tags: r.tags } : {}),
          ...(r.joinUrl ? { link: r.joinUrl } : {}),
        });
      }
    });

    // Outlook, en nombre del invitado (best-effort).
    let graphError = null;
    if (r.graphEventId && r.casilla && await graphConfigurado()) {
      try {
        const col = await prisma.colaborador.findUnique({ where: { id: yo }, select: { email: true } });
        if (col?.email) {
          await responderInvitacion({ casillaOrganizador: r.casilla, eventId: r.graphEventId, emailInvitado: col.email, respuesta });
        }
      } catch (e) { graphError = `Registrado en la app; no se pudo responder en Outlook (${e.message}): respondé el mail si querés que el organizador lo vea allí.`; }
    }
    res.json({ ok: true, respuesta, graphError });
  } catch (e) { next(e); }
});

// POST /reuniones/sync-outlook { desde, hasta } — SYNC INVERSO (30/07):
// importa a MI grilla las reuniones de MI Outlook (las genere quien las
// genere, p.ej. otras áreas), como ítems espejo dentro del rango pedido.
// Idempotente por iCalUId (outlookUid en el ítem); dentro del rango, el
// Outlook es la verdad para los ítems espejo: los que ya no existen se van.
// Filtros de privacidad: nada privado, cancelado, de día completo, rechazado
// ni sin otros asistentes/link; los eventos con categoría "Tablero Cooptech"
// se saltean (nacieron acá). Solo toca ítems con outlookUid: el resto de la
// grilla es intocable (merge por copia, protocolo de datos).
router.post('/sync-outlook', async (req, res, next) => {
  try {
    if (!(await graphConfigurado())) throw new ApiError(400, 'graph_no_configurado', 'Outlook no está configurado');
    const desde = String(req.body?.desde || ''), hasta = String(req.body?.hasta || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) {
      throw new ApiError(400, 'bad_request', 'Rango de fechas inválido');
    }
    if ((new Date(hasta) - new Date(desde)) / 86400000 > 40) throw new ApiError(400, 'bad_request', 'Rango máximo: 40 días');
    const yo = await prisma.colaborador.findUnique({ where: { id: req.colaborador.id }, select: { id: true, email: true } });
    if (!yo?.email) throw new ApiError(400, 'bad_request', 'Tu ficha no tiene email cargado');

    const eventos = await listarCalendario({ email: yo.email, desde, hasta });

    // Dedup histórico: reuniones del tablero previas a la categoría marcadora.
    const dD = new Date(desde + 'T00:00:00Z'), hD = new Date(hasta + 'T00:00:00Z');
    const nuestras = await prisma.reunion.findMany({
      where: { estado: 'activa', fecha: { gte: dD, lte: hD } }, select: { titulo: true, fecha: true },
    });
    const clavesNuestras = new Set(nuestras.map(r => `${r.fecha.toISOString().slice(0, 10)}|${r.titulo.trim().toLowerCase()}`));

    const deseados = new Map(); // uid -> { fecha, item }
    let salteados = 0;
    for (const ev of eventos) {
      const uid = ev.iCalUId || ev.id;
      const fechaEv = String(ev.start?.dateTime || '').slice(0, 10);
      if (!uid || !fechaEv) continue;
      const link = ev.onlineMeetingUrl || ev.onlineMeeting?.joinUrl || null;
      const otros = Array.isArray(ev.attendees) ? ev.attendees.length : 0;
      const filtrar = ev.isCancelled || ev.isAllDay
        || (ev.sensitivity && ev.sensitivity !== 'normal')
        || (Array.isArray(ev.categories) && ev.categories.includes('Tablero Cooptech'))
        || ev.responseStatus?.response === 'declined'
        || (!link && otros === 0)
        || clavesNuestras.has(`${fechaEv}|${String(ev.subject || '').trim().toLowerCase()}`);
      if (filtrar) { salteados++; continue; }
      const h = horasEntre(String(ev.start?.dateTime || '').slice(11, 16), String(ev.end?.dateTime || '').slice(11, 16));
      deseados.set(uid, {
        fecha: fechaEv,
        item: {
          text: `Reunión (Outlook): ${String(ev.subject || 'Sin asunto').trim()}`.slice(0, 300),
          wip: false, outlookUid: uid,
          ...(h ? { horas: h } : {}),
          ...(link ? { link } : {}),
        },
      });
    }

    let agregadas = 0, actualizadas = 0, eliminadas = 0;
    await prisma.$transaction(async (tx) => {
      const entradas = await tx.grillaEntrada.findMany({ where: { colaboradorId: yo.id, fecha: { gte: dD, lte: hD } } });
      const porFecha = new Map(entradas.map(e => [e.fecha.toISOString().slice(0, 10), e]));
      const vistos = new Set();

      // 1) Espejos existentes: actualizar, mover o eliminar.
      for (const e of entradas) {
        const fechaE = e.fecha.toISOString().slice(0, 10);
        const items = Array.isArray(e.items) ? [...e.items] : [];
        let cambio = false;
        const resultado = [];
        for (const it of items) {
          if (!it?.outlookUid) { resultado.push(it); continue; }
          const d = deseados.get(it.outlookUid);
          if (!d || d.fecha !== fechaE) { cambio = true; eliminadas += d ? 0 : 1; continue; } // borrado o movido de día
          vistos.add(it.outlookUid);
          const nuevo = { ...it, ...d.item };
          if (JSON.stringify(nuevo) !== JSON.stringify(it)) { cambio = true; actualizadas++; }
          resultado.push(nuevo);
        }
        if (cambio) await tx.grillaEntrada.update({ where: { id: e.id }, data: { items: resultado } });
        if (cambio) porFecha.set(fechaE, { ...e, items: resultado });
      }

      // 2) Nuevos (o movidos hacia su día correcto).
      for (const [uid, d] of deseados) {
        if (vistos.has(uid)) continue;
        const fechaD = new Date(d.fecha + 'T00:00:00Z');
        const existente = porFecha.get(d.fecha);
        const items = Array.isArray(existente?.items) ? [...existente.items, d.item] : [d.item];
        if (existente) await tx.grillaEntrada.update({ where: { id: existente.id }, data: { items } });
        else {
          const creada = await tx.grillaEntrada.create({ data: { colaboradorId: yo.id, fecha: fechaD, items } });
          porFecha.set(d.fecha, creada);
        }
        if (existente) porFecha.set(d.fecha, { ...existente, items });
        agregadas++;
      }
    });

    res.json({ ok: true, agregadas, actualizadas, eliminadas, salteados, encontradas: deseados.size });
  } catch (e) { next(e); }
});

// GET /reuniones/:id/respuestas-outlook — respuestas EN VIVO desde el evento
// (internos y externos por igual; para externos es la única fuente de verdad).
router.get('/:id/respuestas-outlook', async (req, res, next) => {
  try {
    const r = await prisma.reunion.findUnique({ where: { id: Number(req.params.id) } });
    if (!r || r.estado !== 'activa') throw new ApiError(404, 'not_found', 'Reunión inexistente o cancelada');
    const soy = (Array.isArray(r.colaboradoresIds) ? r.colaboradoresIds : []).includes(req.colaborador?.id);
    if (!soy && req.colaborador?.tipo !== 'manager') throw new ApiError(403, 'forbidden', 'Solo participantes');
    if (!r.graphEventId || !r.casilla || !(await graphConfigurado())) return res.json({ respuestas: [], sinOutlook: true });
    const respuestas = await obtenerRespuestasEvento({ casilla: r.casilla, eventId: r.graphEventId });
    res.json({ respuestas });
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
    notificarColaboradores(ids.filter(i => i !== req.colaborador?.id), {
      titulo: 'Reunión cancelada',
      cuerpo: `${r.titulo} · ${r.fecha.toISOString().slice(0, 10).split('-').reverse().join('/')} ${r.horaInicio}`,
      url: '/',
    });
    res.json({ ok: true, graphError });
  } catch (e) { next(e); }
});

export default router;

// "Mis Deseos" — pedidos de desarrollo/mejora de cualquier colaborador.
// Circuito: borrador → enviado → en_revision → aprobado | rechazado | requiere_cambios.
// El solicitante ve y edita lo suyo; el manager ve todo, responde y aprueba
// (la aprobación crea la card en el backlog del kanban con trazabilidad).
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

const incluirNombres = {
  include: {
    // sin relaciones FK en el schema (aditivo simple): resolvemos nombres aparte
  },
};

async function conNombres(deseos) {
  const ids = [...new Set(deseos.flatMap(d => [d.solicitanteId, d.respondidoPorId]).filter(Boolean))];
  const cols = ids.length ? await prisma.colaborador.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } }) : [];
  const nombre = Object.fromEntries(cols.map(c => [c.id, c.nombre]));
  return deseos.map(d => ({
    ...d,
    solicitante: nombre[d.solicitanteId] || `#${d.solicitanteId}`,
    respondidoPor: d.respondidoPorId ? (nombre[d.respondidoPorId] || `#${d.respondidoPorId}`) : null,
  }));
}

// GET /deseos → los propios; ?todos=1 (solo manager) → todos.
router.get('/', async (req, res, next) => {
  try {
    const esManager = req.colaborador?.tipo === 'manager';
    const where = (esManager && req.query.todos) ? {} : { solicitanteId: req.colaborador.id };
    const deseos = await prisma.deseo.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ deseos: await conNombres(deseos) });
  } catch (e) { next(e); }
});

// POST /deseos { titulo, descripcion, fechaNecesidad?, enviar? }
router.post('/', async (req, res, next) => {
  try {
    const titulo = String(req.body?.titulo || '').trim();
    const descripcion = String(req.body?.descripcion || '').trim();
    if (!titulo) throw new ApiError(400, 'bad_request', 'Falta el título');
    if (!descripcion) throw new ApiError(400, 'bad_request', 'Falta la descripción (contá qué necesitás y para qué)');
    const deseo = await prisma.deseo.create({
      data: {
        titulo, descripcion,
        solicitanteId: req.colaborador.id,
        fechaNecesidad: req.body?.fechaNecesidad ? new Date(String(req.body.fechaNecesidad) + 'T00:00:00Z') : null,
        estado: req.body?.enviar ? 'enviado' : 'borrador',
      },
    });
    res.status(201).json(deseo);
  } catch (e) { next(e); }
});

// PATCH /deseos/:id — el solicitante edita/envía mientras esté en borrador o
// requiere_cambios; el manager cambia estado y responde.
router.patch('/:id', async (req, res, next) => {
  try {
    const deseo = await prisma.deseo.findUnique({ where: { id: Number(req.params.id) } });
    if (!deseo) throw new ApiError(404, 'not_found', 'Deseo inexistente');
    const esManager = req.colaborador?.tipo === 'manager';
    const esDuenio = deseo.solicitanteId === req.colaborador.id;
    const data = {};

    if (esDuenio && ['borrador', 'requiere_cambios'].includes(deseo.estado)) {
      if ('titulo' in (req.body || {}) && String(req.body.titulo).trim()) data.titulo = String(req.body.titulo).trim();
      if ('descripcion' in (req.body || {}) && String(req.body.descripcion).trim()) data.descripcion = String(req.body.descripcion).trim();
      if ('fechaNecesidad' in (req.body || {})) data.fechaNecesidad = req.body.fechaNecesidad ? new Date(String(req.body.fechaNecesidad) + 'T00:00:00Z') : null;
      if (req.body?.enviar) data.estado = 'enviado';
    }

    if (esManager && 'estado' in (req.body || {})) {
      const nuevo = String(req.body.estado);
      if (!['en_revision', 'rechazado', 'requiere_cambios', 'enviado'].includes(nuevo)) {
        throw new ApiError(400, 'bad_request', 'Estado inválido (la aprobación va por /aprobar)');
      }
      const respuesta = String(req.body?.respuesta || '').trim();
      if (['rechazado', 'requiere_cambios'].includes(nuevo) && !respuesta) {
        throw new ApiError(400, 'bad_request', 'La respuesta es obligatoria al rechazar o pedir cambios');
      }
      data.estado = nuevo;
      if (respuesta) { data.respuesta = respuesta; data.respondidoPorId = req.colaborador.id; data.respondidoAt = new Date(); }
    } else if (esManager && 'respuesta' in (req.body || {})) {
      data.respuesta = String(req.body.respuesta).trim() || null;
      data.respondidoPorId = req.colaborador.id;
      data.respondidoAt = new Date();
    }

    if (!Object.keys(data).length) throw new ApiError(403, 'forbidden', 'Nada para actualizar con tus permisos en este estado');
    const actualizado = await prisma.deseo.update({ where: { id: deseo.id }, data });
    res.json(actualizado);
  } catch (e) { next(e); }
});

// POST /deseos/:id/aprobar { proyectoId?, respuesta? } — solo manager.
// Crea la card en el backlog del kanban con trazabilidad al deseo.
router.post('/:id/aprobar', requireTipo('manager'), async (req, res, next) => {
  try {
    const deseo = await prisma.deseo.findUnique({ where: { id: Number(req.params.id) } });
    if (!deseo) throw new ApiError(404, 'not_found', 'Deseo inexistente');
    if (['aprobado'].includes(deseo.estado)) throw new ApiError(400, 'bad_request', 'Ya está aprobado');
    const solicitante = await prisma.colaborador.findUnique({ where: { id: deseo.solicitanteId }, select: { nombre: true } });

    const resultado = await prisma.$transaction(async (tx) => {
      const tarea = await tx.tarea.create({
        data: {
          titulo: deseo.titulo,
          descripcion: `[Deseo #${deseo.id} de ${solicitante?.nombre || '#' + deseo.solicitanteId}, solicitado el ${deseo.createdAt.toISOString().slice(0, 10)}]\n\n${deseo.descripcion}`,
          kanbanCol: 'backlog',
          proyectoId: req.body?.proyectoId ? Number(req.body.proyectoId) : null,
        },
      });
      const d = await tx.deseo.update({
        where: { id: deseo.id },
        data: {
          estado: 'aprobado',
          tareaId: tarea.id,
          respuesta: String(req.body?.respuesta || '').trim() || deseo.respuesta || 'Aprobado: pasa al backlog de desarrollo.',
          respondidoPorId: req.colaborador.id,
          respondidoAt: new Date(),
        },
      });
      return { deseo: d, tarea };
    });
    res.json(resultado);
  } catch (e) { next(e); }
});

// DELETE /deseos/:id — el solicitante borra sus borradores; manager cualquiera.
router.delete('/:id', async (req, res, next) => {
  try {
    const deseo = await prisma.deseo.findUnique({ where: { id: Number(req.params.id) } });
    if (!deseo) throw new ApiError(404, 'not_found', 'Deseo inexistente');
    const esManager = req.colaborador?.tipo === 'manager';
    const puede = esManager || (deseo.solicitanteId === req.colaborador.id && deseo.estado === 'borrador');
    if (!puede) throw new ApiError(403, 'forbidden', 'Solo podés borrar tus borradores');
    await prisma.deseo.delete({ where: { id: deseo.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;

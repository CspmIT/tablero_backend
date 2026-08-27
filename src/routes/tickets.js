// Inbox → Tickets (20/08) — mini sistema de tickets espejo de la Mesa de ayuda
// de la cooperativa. Hoy la carga es MANUAL (el equipo digitaliza los reclamos
// del WhatsApp de guardia porque el área Desarrollo aún no existe como opción
// en la Mesa de ayuda); el modelo ya está preparado para el sync por API
// (origen=mesa_ayuda + externalId) cuando Guillermo exponga los endpoints.
// Permisos (decisión Leonardo 20/08): todo el equipo interno ve, carga y
// trabaja tickets; externos/tercerizados afuera; borrar y reasignar es de
// manager/gerencial. Diseño: claude/Inbox_Tickets_ReporteOV_diseno_20_08.md
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { borrarBinario } from '../lib/almacenamiento.js';
import { estadoSync, guardarConfigSync, sincronizarMesaAyuda, avisarEstadoMesa } from '../lib/mesaAyudaSync.js';

const router = Router();
router.use(requireTipo('manager', 'gerencial', 'collaborator'));

const ESTADOS = ['abierto', 'en_proceso', 'resuelto', 'cerrado'];
const OV_TIPOS = ['incidente', 'solicitud'];
const OV_CAUSAS = ['ov_interna', 'interna_otra', 'procoop', 'terceros'];
const CATEGORIAS = ['a', 'b', 'c']; // mandato M1: desarrollo propio / integración ERP / botón de pago

async function conNombres(tickets) {
  const ids = [...new Set(tickets.flatMap((t) => [t.creadoPorId, t.asignadoAId]).filter(Boolean))];
  const cols = ids.length ? await prisma.colaborador.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } }) : [];
  const nombre = Object.fromEntries(cols.map((c) => [c.id, c.nombre]));
  return tickets.map((t) => ({
    ...t,
    creadoPor: t.creadoPorId ? (nombre[t.creadoPorId] || `#${t.creadoPorId}`) : null,
    asignadoA: t.asignadoAId ? (nombre[t.asignadoAId] || `#${t.asignadoAId}`) : null,
  }));
}

// GET /tickets?estado=&desde=&hasta=&q=
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.estado && ESTADOS.includes(String(req.query.estado))) where.estado = String(req.query.estado);
    if (req.query.desde || req.query.hasta) {
      where.createdAt = {};
      if (req.query.desde) where.createdAt.gte = new Date(`${String(req.query.desde).slice(0, 10)}T00:00:00.000Z`);
      if (req.query.hasta) where.createdAt.lte = new Date(`${String(req.query.hasta).slice(0, 10)}T23:59:59.999Z`);
    }
    const tickets = await prisma.ticket.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ tickets: await conNombres(tickets), ovTipos: OV_TIPOS, ovCausas: OV_CAUSAS, categorias: CATEGORIAS });
  } catch (e) { next(e); }
});

// --- Conector Mesa de ayuda (24/08). Literales ANTES de /:id (lección 05/08). ---
// Estado del conector (sin el token — jamás viaja al frontend).
router.get('/sync-mesa/estado', async (req, res, next) => {
  try { res.json(await estadoSync()); } catch (e) { next(e); }
});
// Configurar URL/token/área: solo gestores (el token es una credencial).
router.put('/sync-mesa/config', async (req, res, next) => {
  try {
    if (!['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'La configuración del conector es de manager/gerencial');
    }
    await guardarConfigSync(req.body || {});
    res.json(await estadoSync());
  } catch (e) { next(e); }
});
// Sincronizar ahora (gestores): corre una pasada completa y devuelve el resumen.
router.post('/sync-mesa', async (req, res, next) => {
  try {
    if (!['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Sincronizar es de manager/gerencial');
    }
    res.json(await sincronizarMesaAyuda('manual'));
  } catch (e) { next(e); }
});

// GET /tickets/:id — detalle con hilo de mensajes
router.get('/:id', async (req, res, next) => {
  try {
    const t = await prisma.ticket.findUnique({ where: { id: Number(req.params.id) } });
    if (!t) throw new ApiError(404, 'not_found', 'Ticket no encontrado');
    const mensajes = await prisma.ticketMensaje.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'asc' } });
    const [conN] = await conNombres([t]);
    res.json({ ticket: conN, mensajes });
  } catch (e) { next(e); }
});

const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;

// POST /tickets — carga manual (digitalizar WhatsApp / cliente interno sin ticket)
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const titulo = limpiar(b.titulo);
    const descripcion = String(b.descripcion || '').trim();
    if (!titulo) throw new ApiError(400, 'bad_request', 'Falta el título');
    if (!descripcion) throw new ApiError(400, 'bad_request', 'Falta la descripción');
    const t = await prisma.ticket.create({
      data: {
        titulo,
        descripcion,
        sector: limpiar(b.sector),
        tipo: limpiar(b.tipo) || 'Incidente',
        prioridad: limpiar(b.prioridad) || 'Media',
        area: 'Oficina Virtual', // fijo en carga manual (24/08: el área en la Mesa será «Oficina Virtual»; por API viaja el del sistema origen)
        copiarA: String(b.copiarA || '').trim() || null,
        origen: b.origen === 'whatsapp' ? 'whatsapp' : 'manual',
        solicitante: limpiar(b.solicitante),
        creadoPorId: req.colaborador.id,
        asignadoAId: b.asignadoAId ? Number(b.asignadoAId) : null,
        ovTipo: OV_TIPOS.includes(b.ovTipo) ? b.ovTipo : null,
        ovCausa: OV_CAUSAS.includes(b.ovCausa) ? b.ovCausa : null,
        categoriaFalla: CATEGORIAS.includes(b.categoriaFalla) ? b.categoriaFalla : null,
        ocurridoAt: b.ocurridoAt ? new Date(`${String(b.ocurridoAt).slice(0, 10)}T12:00:00.000Z`) : null,
      },
    });
    res.status(201).json(t);
  } catch (e) { next(e); }
});

// PATCH /tickets/:id — edición de campos, estado (estampa resueltoAt/cerradoAt),
// clasificación OV y vínculo al ítem de grilla. Reasignar: manager/gerencial.
router.patch('/:id', async (req, res, next) => {
  try {
    const t = await prisma.ticket.findUnique({ where: { id: Number(req.params.id) } });
    if (!t) throw new ApiError(404, 'not_found', 'Ticket no encontrado');
    const b = req.body || {};
    const esGestor = ['manager', 'gerencial'].includes(req.colaborador?.tipo);
    const data = {};

    // Edición de la CARGA (título/descripción/sector/tipo/prioridad/solicitante):
    // solo el autor que la digitalizó + manager/gerencial (decisión de Leonardo
    // 20/08, feedback de Juan: corregir errores ortográficos). Estado,
    // clasificación OV, vínculo y mensajes siguen abiertos a todo el interno.
    const editaCarga = ['titulo', 'sector', 'tipo', 'prioridad', 'solicitante', 'descripcion'].some((k) => b[k] !== undefined);
    const esAutor = t.creadoPorId != null && t.creadoPorId === req.colaborador?.id;
    if (editaCarga && !esGestor && !esAutor) {
      throw new ApiError(403, 'forbidden', 'El texto del ticket lo edita quien lo cargó o manager/gerencial');
    }
    for (const k of ['titulo', 'sector', 'tipo', 'prioridad', 'solicitante']) {
      if (b[k] !== undefined) data[k] = limpiar(b[k]) || (k === 'titulo' ? t.titulo : null);
    }
    if (b.descripcion !== undefined && String(b.descripcion).trim()) data.descripcion = String(b.descripcion).trim();
    if (b.copiarA !== undefined) data.copiarA = String(b.copiarA || '').trim() || null;
    if (b.ocurridoAt !== undefined) data.ocurridoAt = b.ocurridoAt ? new Date(`${String(b.ocurridoAt).slice(0, 10)}T12:00:00.000Z`) : null;

    if (b.asignadoAId !== undefined) {
      if (!esGestor && Number(b.asignadoAId) !== req.colaborador.id && b.asignadoAId !== null) {
        throw new ApiError(403, 'forbidden', 'Reasignar a otro es de manager/gerencial (tomarlo para vos sí podés)');
      }
      data.asignadoAId = b.asignadoAId ? Number(b.asignadoAId) : null;
    }

    if (b.estado !== undefined) {
      if (!ESTADOS.includes(b.estado)) throw new ApiError(400, 'bad_request', 'Estado inválido');
      data.estado = b.estado;
      if (b.estado === 'resuelto' && !t.resueltoAt) data.resueltoAt = new Date();
      if (b.estado === 'cerrado' && !t.cerradoAt) data.cerradoAt = new Date();
      if (['abierto', 'en_proceso'].includes(b.estado)) { data.resueltoAt = null; data.cerradoAt = null; } // reabrir
    }

    // Clasificación OV (alimenta Métricas OV)
    if (b.ovTipo !== undefined) {
      if (b.ovTipo !== null && !OV_TIPOS.includes(b.ovTipo)) throw new ApiError(400, 'bad_request', 'ovTipo inválido');
      data.ovTipo = b.ovTipo;
    }
    if (b.ovCausa !== undefined) {
      if (b.ovCausa !== null && !OV_CAUSAS.includes(b.ovCausa)) throw new ApiError(400, 'bad_request', 'ovCausa inválida');
      data.ovCausa = b.ovCausa;
    }
    if (b.categoriaFalla !== undefined) {
      if (b.categoriaFalla !== null && !CATEGORIAS.includes(b.categoriaFalla)) throw new ApiError(400, 'bad_request', 'categoría inválida (a|b|c)');
      data.categoriaFalla = b.categoriaFalla;
    }

    // Vínculo al ítem de grilla (antidoble-conteo). Se valida que exista.
    if (b.grillaEntradaId !== undefined || b.grillaItemId !== undefined) {
      if (!b.grillaEntradaId || !b.grillaItemId) { data.grillaEntradaId = null; data.grillaItemId = null; }
      else {
        const e = await prisma.grillaEntrada.findUnique({ where: { id: Number(b.grillaEntradaId) } });
        const items = Array.isArray(e?.items) ? e.items : [];
        if (!items.some((it) => it && typeof it === 'object' && it.id === b.grillaItemId)) {
          throw new ApiError(404, 'not_found', 'Ese ítem de grilla no existe (recargá y probá de nuevo)');
        }
        const otro = await prisma.ticket.findFirst({ where: { grillaItemId: String(b.grillaItemId), id: { not: t.id } } });
        if (otro) throw new ApiError(409, 'conflict', `Ese ítem ya está vinculado al ticket #${otro.id}`);
        data.grillaEntradaId = Number(b.grillaEntradaId);
        data.grillaItemId = String(b.grillaItemId);
      }
    }

    const actualizado = await prisma.ticket.update({ where: { id: t.id }, data });
    // CICLO COMPLETO (24/08): si cambió el ESTADO de un ticket que vino de la
    // Mesa de ayuda, se le avisa (el equipo no tiene usuarios resolutores allá
    // — sin esto sus tickets quedarían eternamente abiertos en la Mesa). Best
    // effort: el cambio local ya está hecho; si la Mesa no responde, va el
    // aviso en la respuesta y el frontend lo muestra (la próxima sincronización
    // podría volver a traer el estado viejo hasta que la Mesa se entere).
    let mesaAviso;
    if (data.estado !== undefined && t.origen === 'mesa_ayuda' && t.externalId) {
      // ACUERDO con Guillermo (27/08, decisión de Leonardo): a la Mesa viaja
      // «resuelto» aunque acá se cierre — solo un ticket Resuelto se puede
      // REABRIR allá, y ese circuito es lo que hace útil la integración.
      // «cerrado» local queda como estado interno del tablero.
      const estadoMesa = data.estado === 'cerrado' ? 'resuelto' : data.estado;
      mesaAviso = await avisarEstadoMesa(t.externalId, {
        estado: estadoMesa,
        comentario: `Estado actualizado desde el Tablero Cooptech por ${req.colaborador?.nombre || 'el equipo'}${data.estado === 'cerrado' ? ' (cierre interno del tablero — el solicitante conserva la reapertura)' : ''}`,
      });
    }
    res.json(mesaAviso ? { ...actualizado, mesaAviso } : actualizado);
  } catch (e) { next(e); }
});

// POST /tickets/:id/mensajes { texto }
router.post('/:id/mensajes', async (req, res, next) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new ApiError(400, 'bad_request', 'Falta el texto');
    const t = await prisma.ticket.findUnique({ where: { id: Number(req.params.id) } });
    if (!t) throw new ApiError(404, 'not_found', 'Ticket no encontrado');
    const m = await prisma.ticketMensaje.create({
      data: { ticketId: t.id, autorId: req.colaborador.id, autor: req.colaborador.nombre || null, texto },
    });
    await prisma.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
    res.status(201).json(m);
  } catch (e) { next(e); }
});

// DELETE /tickets/:id — solo manager/gerencial. Se lleva sus mensajes y sus
// adjuntos (fix de Juan 21/08, masters 8): hasta entonces los adjuntos quedaban
// como filas huérfanas en Archivo (y binarios eternos en MinIO, que ahora sí
// expone borrado — lib/almacenamiento.js).
router.delete('/:id', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) throw new ApiError(404, 'not_found', 'Ticket no encontrado');
    // Los adjuntos del ticket se identifican como los sube el frontend:
    // contexto 'ticket' + url 'ticket:<id>'.
    const adjuntos = await prisma.archivo.findMany({ where: { contexto: 'ticket', url: `ticket:${id}` } });
    await prisma.ticketMensaje.deleteMany({ where: { ticketId: id } }); // hijos del ticket borrado (alcance acotado por FK lógica)
    await prisma.ticket.delete({ where: { id } });
    if (adjuntos.length) {
      await prisma.archivo.deleteMany({ where: { id: { in: adjuntos.map((a) => a.id) } } });
      // Binario: best effort, igual que en DELETE /archivos/:id (si el gateway
      // no responde, el ticket ya se borró y queda el aviso en el log).
      for (const a of adjuntos) await borrarBinario(a.key);
    }
    res.json({ ok: true, adjuntosBorrados: adjuntos.length });
  } catch (e) { next(e); }
});

export default router;

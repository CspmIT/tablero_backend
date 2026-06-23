import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

const LEAD_FIELDS = ['organizacion','contactoNombre','telefono','email','ciudad','fechaPrimerContacto',
  'ownerId','etapa','valorEstimadoUsd','esEvento','montoFacturadoUsd','cantidadEquipos','equiposDetalle',
  'proximaAccion','proximaAccionFecha','motivoPerdido','notas','fuente','fuenteOtra',
  'trialVence','trialNotas','presupuestoEnviadoFecha','presupuestoAprobadoFecha','presupuestoLink',
  'presupuestoEstado','presupuestoAguaEstado','coopcloudEstado','coopcloudCostoMensual'];

const LEAD_DATE_FIELDS = ['fechaPrimerContacto', 'proximaAccionFecha', 'trialVence', 'presupuestoEnviadoFecha', 'presupuestoAprobadoFecha'];
const coerceFecha = (v) => {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00.000Z');
  return isNaN(d.getTime()) ? null : d;
};

function pickLead(body) {
  const out = {};
  for (const k of LEAD_FIELDS) if (k in body) out[k] = body[k];
  for (const k of LEAD_DATE_FIELDS) if (k in out) out[k] = coerceFecha(out[k]);
  if ('cantidadEquipos' in out) out.cantidadEquipos = out.cantidadEquipos === '' || out.cantidadEquipos == null ? null : Number(out.cantidadEquipos);
  for (const k of ['valorEstimadoUsd', 'montoFacturadoUsd', 'coopcloudCostoMensual']) if (k in out) out[k] = out[k] === '' || out[k] == null ? null : Number(out[k]);
  return out;
}

// Listar (paginado + filtros)
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.etapa) where.etapa = req.query.etapa;
    if (req.query.ownerId) where.ownerId = Number(req.query.ownerId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const [rows, total] = await Promise.all([
      prisma.lead.findMany({ where, include: { productos: true }, orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize }),
      prisma.lead.count({ where }),
    ]);
    const data = rows.map(l => ({ ...l, productos: l.productos.map(p => p.producto) }));
    res.json({ data, pagination: { page, pageSize, total } });
  } catch (e) { next(e); }
});

// Crear (con productos como array de strings)
router.post('/', async (req, res, next) => {
  try {
    const data = pickLead(req.body);
    const productos = Array.isArray(req.body.productos) ? req.body.productos : [];
    const created = await prisma.lead.create({
      data: { ...data, productos: { create: productos.map(p => ({ producto: p })) } },
      include: { productos: true },
    });
    res.status(201).json({ ...created, productos: created.productos.map(p => p.producto) });
  } catch (e) { next(e); }
});

// Obtener
router.get('/:id', async (req, res, next) => {
  try {
    const l = await prisma.lead.findUnique({ where: { id: Number(req.params.id) }, include: { productos: true } });
    if (!l) throw new ApiError(404, 'not_found', 'Lead no encontrado');
    res.json({ ...l, productos: l.productos.map(p => p.producto) });
  } catch (e) { next(e); }
});

// Actualizar (incluye los estados de presupuestadores y, opcionalmente, productos)
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = pickLead(req.body);
    if (Array.isArray(req.body.productos)) {
      await prisma.leadProducto.deleteMany({ where: { leadId: id } });
      data.productos = { create: req.body.productos.map(p => ({ producto: p })) };
    }
    const updated = await prisma.lead.update({ where: { id }, data, include: { productos: true } });
    res.json({ ...updated, productos: updated.productos.map(p => p.producto) });
  } catch (e) { next(e); }
});

// Eliminar
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.lead.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (e) { next(e); }
});

// Actividades del lead (Objetivo 8)
router.get('/:id/actividades', async (req, res, next) => {
  try {
    const data = await prisma.crmActividad.findMany({
      where: { leadId: Number(req.params.id) }, orderBy: { fecha: 'desc' } });
    res.json(data);
  } catch (e) { next(e); }
});

router.post('/:id/actividades', async (req, res, next) => {
  try {
    const created = await prisma.crmActividad.create({
      data: {
        leadId: Number(req.params.id),
        colaboradorId: req.body.colaboradorId ?? req.colaborador?.id ?? null,
        tipo: req.body.tipo,
        fecha: new Date(req.body.fecha),
        notas: req.body.notas ?? null,
      },
    });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

// Ganar: marca el lead como ganado, crea el proyecto (hand-off CRM -> Kanban) y
// siembra el backlog con las tareas de las plantillas seleccionadas.
// Body opcional: { plantillas: ['tpl_reconecta', ...], cantidadEquipos: N }
router.post('/:id/ganar', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new ApiError(404, 'not_found', 'Lead no encontrado');

    const plantillaIds = (Array.isArray(req.body?.plantillas) ? req.body.plantillas : [])
      .map(Number).filter((n) => Number.isInteger(n));
    const nEquipos = Math.max(1, Number(req.body?.cantidadEquipos) || lead.cantidadEquipos || 1);
    const plantillas = plantillaIds.length
      ? await prisma.plantilla.findMany({ where: { id: { in: plantillaIds } } })
      : [];

    // IDs de colaboradores válidos: evita romper la clave foránea con owner/responsables inexistentes.
    const colabIds = new Set((await prisma.colaborador.findMany({ select: { id: true } })).map((c) => c.id));
    const ownerValido = lead.ownerId && colabIds.has(lead.ownerId) ? lead.ownerId : null;
    const PRIORIDADES = new Set(['baja', 'media', 'alta', 'urgente']);
    const nombreProyecto = (lead.organizacion && lead.organizacion.trim()) || `Lead ${id}`;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({ where: { id }, data: { etapa: 'ganado' } });
      const proyecto = await tx.proyecto.create({
        data: { nombre: nombreProyecto, cliente: nombreProyecto, leadId: id, ownerId: ownerValido, estado: 'activo' },
      });

      // Sembrar el backlog: una tarjeta por etapa; las "por_equipo" llevan N unidades.
      let orden = 0;
      let creadas = 0;
      for (const pl of plantillas) {
        const etapas = Array.isArray(pl.etapas) ? [...pl.etapas].sort((a, b) => (a.seq || 0) - (b.seq || 0)) : [];
        for (const et of etapas) {
          const prio = et.prioridad || et.priority || 'media';
          const data = {
            proyectoId: proyecto.id, titulo: et.titulo || 'Tarea', descripcion: et.desc || null,
            kanbanCol: 'backlog', prioridad: PRIORIDADES.has(prio) ? prio : 'media', orden: orden++,
          };
          if (et.tipo === 'por_equipo') {
            data.unidades = Array.from({ length: nEquipos }, (_, i) => ({
              id: 'u_' + i + '_' + Math.random().toString(36).slice(2, 7),
              label: `${pl.unidadLabel || 'unidad'} ${i + 1}`, hecho: false,
            }));
          }
          // Solo responsables que existan como colaboradores (descarta slugs o ids borrados).
          const owners = (Array.isArray(et.owners) ? et.owners : [])
            .map(Number).filter((n) => Number.isInteger(n) && colabIds.has(n));
          if (owners.length) {
            data.responsables = { create: owners.map((colaboradorId) => ({ colaboradorId })) };
          }
          await tx.tarea.create({ data });
          creadas++;
        }
      }
      return { lead: updated, proyecto, tareasCreadas: creadas };
    });
    res.json(result);
  } catch (e) { next(e); }
});

export default router;

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { graphConfigurado, crearEventoVideollamada, resolverGraphConfig, diasParaVencer } from '../lib/graph.js';
import { horasEntre } from './reuniones.js';
import { notificarColaboradores, notificarSuscriptosA } from '../lib/push.js';
import { getConfig, setConfig } from '../lib/config.js';

const router = Router();

// Catálogo de productos comercializables (05/08): gestionable desde la app
// (engranaje del CRM → Listado de productos), persistido en Configuracion.
// Nunca más un deploy para agregar un producto.
const PRODUCTOS_DEFAULT = ['+Agua', 'Reconecta', 'Centinela', 'CoopCloud', 'Call Center', 'Antivirus ESET', 'Cooptech (consultoría)', 'Otro'];

const LEAD_FIELDS = ['organizacion','contactoNombre','cargo','telefono','email','ciudad','fechaPrimerContacto',
  'ownerId','etapa','valorEstimadoUsd','esEvento','montoFacturadoUsd','cantidadEquipos','equiposDetalle',
  'proximaAccion','proximaAccionFecha','motivoPerdido','notas','fuente','fuenteOtra',
  'trialVence','trialNotas','presupuestoEnviadoFecha','presupuestoAprobadoFecha','presupuestoLink',
  'abonoMensualUsd','fechaGanado',
  'presupuestoEstado','presupuestoAguaEstado','coopcloudEstado','coopcloudCostoMensual'];

const LEAD_DATE_FIELDS = ['fechaPrimerContacto', 'proximaAccionFecha', 'trialVence', 'presupuestoEnviadoFecha', 'presupuestoAprobadoFecha', 'fechaGanado'];
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
  for (const k of ['valorEstimadoUsd', 'montoFacturadoUsd', 'coopcloudCostoMensual', 'abonoMensualUsd']) if (k in out) out[k] = out[k] === '' || out[k] == null ? null : Number(out[k]);
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
    // ORDEN EN DOS PASOS (20/08): MySQL no puede ORDENAR filas anchas — falla con
    // 1038 "Out of sort memory" en cuanto UNA fila supera el sort_buffer_size del
    // servidor (256 KB acá). Pasó con el relevamiento de Balnearia: 390 KB de JSON
    // en presupuestoAguaEstado (el mapa de la localidad y el logo van en base64) y
    // todo el CRM devolvía 500. Primero se ordena y paginá una consulta FINA (solo
    // el id; el sort ni ve los JSON) y después se traen las filas completas por id,
    // sin ORDER BY, reordenándolas en memoria. La respuesta es idéntica.
    const [orden, total] = await Promise.all([
      prisma.lead.findMany({ where, select: { id: true }, orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize }),
      prisma.lead.count({ where }),
    ]);
    const ids = orden.map(o => o.id);
    const rows = ids.length ? await prisma.lead.findMany({ where: { id: { in: ids } }, include: {
      productos: true,
      // Tareas pendientes (livianas) para el distintivo de vencidas en la tarjeta.
      tareasSeguimiento: { where: { done: false }, select: { id: true, fechaLimite: true } },
    } }) : [];
    const porId = new Map(rows.map(r => [r.id, r]));
    // LISTA LIVIANA (21/08, punto 5.3 del doc de Juan — decisión de Leonardo):
    // las 3 columnas JSON de los presupuestadores NO viajan en la lista (con un
    // relevamiento real la respuesta pesaba 699 KB y el 56 % era UN lead). El
    // frontend las necesita solo al ABRIR un presupuestador, y ahí pide el lead
    // completo por id (GET /leads/:id). En su lugar van banderas livianas.
    const data = ids.map(id => porId.get(id)).filter(Boolean)
      .map(({ presupuestoEstado, presupuestoAguaEstado, coopcloudEstado, ...l }) => ({
        ...l,
        productos: l.productos.map(p => p.producto),
        tienePresupuesto: !!presupuestoEstado,
        tieneRelevamientoAgua: !!presupuestoAguaEstado,
        tieneCoopcloud: !!coopcloudEstado,
      }));
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
// --- Vista técnica: leads en "Visita Técnica" con datos mínimos ------------
// Para técnicos y tercerizados: lo necesario para hacer el relevamiento in
// situ (organización, localidad, contacto) SIN el tratamiento comercial del
// lead (valores, tareas, actividades, notas). Incluye el estado del
// relevamiento +Agua para retomarlo/crearlo desde la solapa Visitas técnicas.
router.get('/visitas-tecnicas', async (req, res, next) => {
  try {
    const filas = await prisma.lead.findMany({
      where: { etapa: 'visita_realizada' },
      select: {
        id: true, organizacion: true, ciudad: true,
        contactoNombre: true, telefono: true, email: true,
        productos: { select: { producto: true } },
        presupuestoAguaEstado: true,
        updatedAt: true,
      },
      // Sin ORDER BY a propósito: la fila trae el JSON del relevamiento (megas) y
      // MySQL no puede ordenar filas anchas (1038 "Out of sort memory", 20/08).
      // Se ordena abajo, en memoria, sobre la lista ya liviana.
    });
    // La lista viaja LIVIANA: el estado del relevamiento puede pesar megas
    // (fotos como data-URI). Acá va solo un resumen; el estado completo se
    // baja al abrir el relevamiento (GET /leads/:id/relevamiento-agua).
    const leads = filas.map(({ presupuestoAguaEstado, ...resto }) => ({
      ...resto,
      relevamiento: {
        iniciado: !!presupuestoAguaEstado,
        criteria: presupuestoAguaEstado?.criteria?.metadata || null,
      },
    }));
    leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); // el orden que hacía MySQL
    res.json({ leads });
  } catch (e) { next(e); }
});

// Baja el estado completo del relevamiento de UN lead (al abrirlo).
// GET/PUT del catálogo de productos (todo el equipo puede gestionarlo).
router.get('/productos-catalogo', async (_req, res, next) => {
  try {
    const raw = await getConfig('crm_productos');
    let lista = null;
    try { lista = raw ? JSON.parse(raw) : null; } catch { lista = null; }
    res.json({ productos: Array.isArray(lista) && lista.length ? lista : PRODUCTOS_DEFAULT });
  } catch (e) { next(e); }
});
router.put('/productos-catalogo', async (req, res, next) => {
  try {
    const lista = (Array.isArray(req.body?.productos) ? req.body.productos : [])
      .map(x => String(x).trim()).filter(Boolean).slice(0, 30);
    const unicos = [...new Set(lista)];
    if (!unicos.length) throw new ApiError(400, 'bad_request', 'El catálogo no puede quedar vacío');
    await setConfig('crm_productos', JSON.stringify(unicos));
    res.json({ productos: unicos });
  } catch (e) { next(e); }
});

router.get('/:id/relevamiento-agua', async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: Number(req.params.id) },
      select: { presupuestoAguaEstado: true },
    });
    res.json({ estado: lead?.presupuestoAguaEstado ?? null });
  } catch (e) { next(e); }
});

// Guarda SOLO el estado del relevamiento +Agua (autosave desde la vista
// técnica): no permite tocar ningún otro campo del lead.
router.put('/:id/relevamiento-agua', async (req, res, next) => {
  try {
    await prisma.lead.update({
      where: { id: Number(req.params.id) },
      data: { presupuestoAguaEstado: req.body?.estado ?? null },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Ingresos (ola 3, 07/08) ---------------------------------------------
// Serie mensual de ingresos del año a partir de los leads GANADOS:
//   implementación = montoFacturadoUsd ?? valorEstimadoUsd → mes de fechaGanado
//   abono mensual  = abonoMensualUsd ?? coopcloudCostoMensual → desde el mes de
//                    fechaGanado hasta el mes corriente (ingresos, no proyección)
// Ganados sin fechaGanado se devuelven aparte (la UI pide completarlos).
// Solo lectura. OJO: ruta literal ANTES de '/:id'.
router.get('/ingresos', async (req, res, next) => {
  try {
    const hoy = new Date();
    const anio = Number(req.query.anio) || hoy.getFullYear();
    // Último mes con ingresos "reales" para el año pedido (12 si es pasado, 0 si es futuro).
    const mesLimite = anio < hoy.getFullYear() ? 12 : (anio > hoy.getFullYear() ? 0 : hoy.getMonth() + 1);
    const ganados = await prisma.lead.findMany({ where: { etapa: 'ganado' }, include: { productos: true } });
    const detalle = [];
    const sinFecha = [];
    for (const l of ganados) {
      const productos = l.productos.map((p) => p.producto);
      const producto = productos[0] || 'Otro';
      if (!l.fechaGanado) {
        sinFecha.push({ id: l.id, organizacion: l.organizacion, producto });
        continue;
      }
      const implementacion = l.montoFacturadoUsd != null ? Number(l.montoFacturadoUsd) : (l.valorEstimadoUsd != null ? Number(l.valorEstimadoUsd) : 0);
      const implementacionOrigen = l.montoFacturadoUsd != null ? 'facturado' : (l.valorEstimadoUsd != null ? 'presupuesto' : null);
      const abono = l.abonoMensualUsd != null ? Number(l.abonoMensualUsd) : (l.coopcloudCostoMensual != null ? Number(l.coopcloudCostoMensual) : 0);
      const abonoOrigen = l.abonoMensualUsd != null ? 'manual' : (l.coopcloudCostoMensual != null ? 'coopcloud' : null);
      const fg = new Date(l.fechaGanado);
      const anioG = fg.getUTCFullYear();
      const mesG = fg.getUTCMonth() + 1;
      const meses = Array.from({ length: 12 }, () => ({ implementacion: 0, abono: 0 }));
      if (anioG === anio && implementacion) meses[mesG - 1].implementacion = implementacion;
      if (abono) {
        const desde = anioG < anio ? 1 : (anioG === anio ? mesG : 13);
        for (let m = desde; m <= mesLimite; m++) meses[m - 1].abono = abono;
      }
      const totalAnio = meses.reduce((sum, x) => sum + x.implementacion + x.abono, 0);
      if (totalAnio > 0 || anioG === anio) {
        detalle.push({ id: l.id, organizacion: l.organizacion, producto, productos, fechaGanado: l.fechaGanado, implementacion, implementacionOrigen, abono, abonoOrigen, meses, totalAnio });
      }
    }
    // Serie apilable por producto (para el gráfico) + total por mes.
    const serie = [];
    for (const d of detalle) {
      let fila = serie.find((x) => x.producto === d.producto);
      if (!fila) { fila = { producto: d.producto, meses: Array(12).fill(0) }; serie.push(fila); }
      d.meses.forEach((m, i) => { fila.meses[i] += m.implementacion + m.abono; });
    }
    serie.sort((a, b) => b.meses.reduce((x, y) => x + y, 0) - a.meses.reduce((x, y) => x + y, 0));
    const totalMes = Array(12).fill(0);
    serie.forEach((f) => f.meses.forEach((v, i) => { totalMes[i] += v; }));
    res.json({ anio, mesLimite, detalle, serie, totalMes, sinFecha });
  } catch (e) { next(e); }
});

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
    // Fecha de ganado (ola 3): se estampa SOLA al pasar a ganado si no viene
    // en el body ni existe en la base. Nunca pisa un valor ya cargado.
    if (data.etapa === 'ganado' && !data.fechaGanado) {
      const actual = await prisma.lead.findUnique({ where: { id }, select: { fechaGanado: true } });
      if (actual && !actual.fechaGanado) data.fechaGanado = coerceFecha(new Date().toISOString());
    }
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

// --- Videollamada desde el CRM (ola 1: impacto interno + .ics en el frontend) --
// Crea UNA CrmActividad (tipo videollamada; una por reunión, sin importar los
// asistentes, para no inflar el Objetivo 8) e impacta la grilla de CADA
// colaborador involucrado agregando un ítem a su día (creando la entrada si no
// existía). Todo en una transacción: o impacta completo, o no impacta.
// Body: { fecha: 'YYYY-MM-DD', horaInicio: 'HH:MM', horaFin: 'HH:MM',
//         colaboradoresIds: [int], notas?: string }
router.post('/:id/videollamada', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lead = await prisma.lead.findUnique({ where: { id }, include: { productos: true } });
    if (!lead) throw new ApiError(404, 'not_found', 'Lead no encontrado');

    const { fecha, horaInicio, horaFin, notas } = req.body || {};
    const emailsExternos = (Array.isArray(req.body?.emailsExternos) ? req.body.emailsExternos : [])
      .map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 10);
    const ids = (Array.isArray(req.body?.colaboradoresIds) ? req.body.colaboradoresIds : []).map(Number).filter(Boolean);
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw new ApiError(400, 'bad_request', 'Falta la fecha (YYYY-MM-DD)');
    if (!horaInicio || !horaFin) throw new ApiError(400, 'bad_request', 'Faltan hora de inicio y fin');
    if (!ids.length) throw new ApiError(400, 'bad_request', 'Indicá al menos un colaborador involucrado');

    // Ola 2 (bandera): si Graph está configurado, el evento se crea en el Outlook
    // de la casilla comercial con reunión de Teams e invitaciones automáticas.
    // Si falla o no está configurado, se degrada a la ola 1 (.ics manual) sin
    // frenar el impacto interno.
    let graphInfo = null, graphError = null, avisoVencimiento = null;
    if (await graphConfigurado()) {
      try {
        const involucrados = await prisma.colaborador.findMany({
          where: { id: { in: ids } }, select: { email: true },
        });
        graphInfo = await crearEventoVideollamada({
          organizacion: lead.organizacion,
          fecha: String(fecha), horaInicio, horaFin,
          notas: notas || null,
          emailLead: lead.email || null,
          contactoNombre: lead.contactoNombre || null,
          emailsColaboradores: involucrados.map(c => c.email).filter(Boolean),
          emailsExtra: emailsExternos,
        });
        const cred = await resolverGraphConfig();
        const dias = diasParaVencer(cred?.vence);
        if (dias != null && dias <= 30) {
          avisoVencimiento = dias < 0
            ? 'El secreto de la integración con Outlook figura VENCIDO: renovarlo cuanto antes.'
            : `El secreto de la integración con Outlook vence en ${dias} día${dias === 1 ? '' : 's'}: pedir la renovación.`;
        }
      } catch (e) {
        graphError = e.message || 'Error al crear el evento en Outlook';
      }
    }

    const fechaD = new Date(String(fecha) + 'T00:00:00Z');
    const rango = `${horaInicio}–${horaFin}`;
    const textoItem = `Videollamada ${lead.organizacion} (${rango})`;
    const tagsItem = lead.productos.map(p => p.producto);
    const linkTeams = graphInfo?.joinUrl || null;
    const notasAct = [`Videollamada ${rango}`, notas, linkTeams ? `Teams: ${linkTeams}` : null]
      .filter(Boolean).join(' · ');

    const resultado = await prisma.$transaction(async (tx) => {
      const actividad = await tx.crmActividad.create({
        data: {
          leadId: id,
          colaboradorId: req.colaborador?.id ?? null, // quien la agenda
          tipo: 'videollamada',
          fecha: fechaD,
          notas: notasAct,
        },
      });
      // Ciclo de vida (ola reuniones 16/07): la Reunion guarda el eventId de
      // Outlook y los involucrados → reprogramar/cancelar desde la app.
      const reunion = await tx.reunion.create({
        data: {
          tipo: 'cliente', titulo: lead.organizacion, emailsExternos,
          fecha: fechaD, horaInicio, horaFin, modalidad: 'virtual',
          organizadorId: req.colaborador?.id ?? null,
          leadId: id, crmActividadId: actividad.id,
          colaboradoresIds: ids,
          tags: tagsItem.length ? tagsItem : null,
          graphEventId: graphInfo?.id || null,
          casilla: graphInfo ? (await resolverGraphConfig())?.casilla || null : null,
          joinUrl: linkTeams,
        },
      });
      for (const colaboradorId of ids) {
        const existente = await tx.grillaEntrada.findUnique({
          where: { colaboradorId_fecha: { colaboradorId, fecha: fechaD } },
        });
        const items = Array.isArray(existente?.items) ? [...existente.items] : [];
        if (!items.some(it => it && (it.reunionId === reunion.id || it.text === textoItem))) {
          items.push({ text: textoItem, wip: false, tags: tagsItem, reunionId: reunion.id, horas: horasEntre(horaInicio, horaFin), ...(linkTeams ? { link: linkTeams } : {}) });
        }
        await tx.grillaEntrada.upsert({
          where: { colaboradorId_fecha: { colaboradorId, fecha: fechaD } },
          update: { items },
          create: { colaboradorId, fecha: fechaD, items }, // estado: default (present)
        });
      }
      return { ...actividad, reunionId: reunion.id };
    });
    notificarColaboradores(ids.filter(i => i !== req.colaborador?.id), {
      titulo: 'Invitación a videollamada',
      cuerpo: `${lead.organizacion} · ${fecha.split('-').reverse().join('/')} ${horaInicio}–${horaFin}`,
      url: '/',
    });

    res.status(201).json({
      actividad: resultado,
      impactados: ids,
      item: textoItem,
      modo: graphInfo ? 'graph' : 'ics',
      joinUrl: linkTeams,
      webLink: graphInfo?.webLink || null,
      graphError, // null salvo que Graph esté configurado y haya fallado
      avisoVencimiento,
    });
  } catch (e) { next(e); }
});

// --- Tareas de seguimiento del lead (estilo checklist con vencimiento) --------
router.get('/:id/tareas', async (req, res, next) => {
  try {
    const tareas = await prisma.leadTarea.findMany({
      where: { leadId: Number(req.params.id) },
      orderBy: [{ done: 'asc' }, { fechaLimite: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ tareas });
  } catch (e) { next(e); }
});

router.post('/:id/tareas', async (req, res, next) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new ApiError(400, 'bad_request', 'Falta el texto de la tarea');
    const fechaLimite = req.body?.fechaLimite ? new Date(String(req.body.fechaLimite) + 'T00:00:00Z') : null;
    const tarea = await prisma.leadTarea.create({
      data: {
        leadId: Number(req.params.id),
        texto,
        fechaLimite,
        creadorId: req.colaborador?.id ?? null,
      },
    });
    res.status(201).json(tarea);
  } catch (e) { next(e); }
});

// PATCH: completar (done + resultado opcional), reabrir o editar texto/fecha.
router.patch('/:id/tareas/:tareaId', async (req, res, next) => {
  try {
    const data = {};
    if ('done' in (req.body || {})) {
      data.done = Boolean(req.body.done);
      data.completadoAt = data.done ? new Date() : null;
      if (!data.done) data.resultado = null; // reabrir limpia el resultado
    }
    if ('resultado' in (req.body || {})) data.resultado = req.body.resultado ? String(req.body.resultado) : null;
    if ('texto' in (req.body || {}) && String(req.body.texto).trim()) data.texto = String(req.body.texto).trim();
    if ('fechaLimite' in (req.body || {})) {
      data.fechaLimite = req.body.fechaLimite ? new Date(String(req.body.fechaLimite) + 'T00:00:00Z') : null;
    }
    const tarea = await prisma.leadTarea.update({
      where: { id: Number(req.params.tareaId) },
      data,
    });
    res.json(tarea);
  } catch (e) { next(e); }
});

router.delete('/:id/tareas/:tareaId', async (req, res, next) => {
  try {
    await prisma.leadTarea.delete({ where: { id: Number(req.params.tareaId) } });
    res.status(204).end();
  } catch (e) { next(e); }
});

// --- Datos de facturación (viven en Cliente, no en el lead) -----------------
const FACT_FIELDS = ['razonSocial', 'cuit', 'direccion', 'localidad', 'ciudad', 'celular', 'emailFacturacion'];

// Ficha de facturación para prellenar el formulario: el Cliente vinculado o,
// si no hay vínculo todavía, el que coincida por nombre con la organización.
router.get('/:id/facturacion', async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: Number(req.params.id) } });
    if (!lead) throw new ApiError(404, 'not_found', 'Lead no encontrado');
    const cliente = lead.clienteId
      ? await prisma.cliente.findUnique({ where: { id: lead.clienteId } })
      : await prisma.cliente.findUnique({ where: { nombre: lead.organizacion } });
    res.json({ cliente });
  } catch (e) { next(e); }
});

// Guardar facturación: crea o completa la ficha del Cliente (por vínculo o por
// nombre = organización del lead) y deja el lead vinculado. Sin duplicación:
// si el Cliente ya existía, solo se actualizan los campos enviados.
router.put('/:id/facturacion', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new ApiError(404, 'not_found', 'Lead no encontrado');

    const datos = {};
    for (const k of FACT_FIELDS) {
      if (k in (req.body || {})) datos[k] = req.body[k] === '' ? null : String(req.body[k]);
    }

    let cliente;
    if (lead.clienteId) {
      cliente = await prisma.cliente.update({ where: { id: lead.clienteId }, data: datos });
    } else {
      cliente = await prisma.cliente.upsert({
        where: { nombre: lead.organizacion },
        update: datos,
        create: { nombre: lead.organizacion, ...datos },
      });
      await prisma.lead.update({ where: { id }, data: { clienteId: cliente.id } });
    }
    res.json({ cliente });
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
      const updated = await tx.lead.update({ where: { id }, data: { etapa: 'ganado', ...(lead.fechaGanado ? {} : { fechaGanado: coerceFecha(new Date().toISOString()) }) } });
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
    // Notificación opt-in "CRM: lead ganado" (preferencias de Configuración).
    notificarSuscriptosA('crm_lead_ganado', {
      titulo: '🎉 Lead ganado',
      cuerpo: nombreProyecto,
      url: '/',
    }, req.colaborador?.id);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;

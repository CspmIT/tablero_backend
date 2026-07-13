import { Router } from 'express';
import { crudRouter } from '../lib/crudRouter.js';
import { requireProvisioned, requireTipo } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

import authRouter from './auth.js';
import leadsRouter from './leads.js';
import archivosRouter from './archivos.js';
import grillaRouter from './grilla.js';
import guardiasRouter from './guardias.js';
import tareasRouter from './tareas.js';
import carryoverRouter from './carryover.js';
import costosRouter from './costos.js';
import importarRouter from './importar.js';
import asistenteRouter from './asistente.js';
import analisisRouter from './analisis.js';

const router = Router();

// auth/me no exige estar aprovisionado (informa si lo está o no)
router.use('/auth', authRouter);

// De acá en adelante, hay que estar habilitado en el tablero
router.use(requireProvisioned);

// Actividades de CRM por colaborador y rango (solo lectura; alimenta las sugerencias de "Mi semana").
router.get('/actividades', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.colaboradorId) where.colaboradorId = Number(req.query.colaboradorId);
    if (req.query.desde || req.query.hasta) {
      where.fecha = {};
      if (req.query.desde) where.fecha.gte = new Date(req.query.desde);
      if (req.query.hasta) where.fecha.lte = new Date(req.query.hasta);
    }
    const data = await prisma.crmActividad.findMany({
      where, orderBy: { fecha: 'desc' },
      include: { lead: { select: { organizacion: true } } },
    });
    res.json({ data });
  } catch (e) { next(e); }
});

// --- Colaboradores: coerción de fechas (string -> Date) y reemplazo del set de
//     períodos al guardar, igual que el modal del standalone (handleSave). ---
function coerceFecha(v) {
  if (v === undefined) return undefined;
  if (!v) return null;
  return new Date(typeof v === 'string' && v.length === 10 ? v + 'T00:00:00Z' : v);
}
function colaboradorTransform(data, req) {
  const out = { ...data };
  if ('fechaIngreso' in out) out.fechaIngreso = coerceFecha(out.fechaIngreso);
  if ('fechaSalida' in out) out.fechaSalida = coerceFecha(out.fechaSalida);
  if ('periodos' in out) {
    const create = (Array.isArray(out.periodos) ? out.periodos : [])
      .filter(p => p && p.desde)
      .map(p => ({ desde: coerceFecha(p.desde), hasta: coerceFecha(p.hasta) }));
    if (req.method === 'POST') {
      if (create.length) out.periodos = { create };
      else delete out.periodos;
    } else {
      // PATCH: reemplaza el set completo (puede quedar vacío para roles no operativos)
      out.periodos = create.length ? { deleteMany: {}, create } : { deleteMany: {} };
    }
  }
  return out;
}

// Eliminación de colaborador. Sin ?force=1 no borra si tiene datos asociados:
// responde 409 con el detalle para confirmar. Con ?force=1 borra; la base resuelve
// la cascada (grilla, tareas, francos, WIPs, carryover, períodos) y desvincula
// leads/proyectos/actividades (SetNull) según el schema. Pensado para limpiar duplicados.
router.delete('/colaboradores/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const force = req.query.force === '1' || req.query.force === 'true';
    const [grilla, tareas, francos, wips, carryover, actividades, leads, proyectos] = await Promise.all([
      prisma.grillaEntrada.count({ where: { colaboradorId: id } }),
      prisma.tareaResponsable.count({ where: { colaboradorId: id } }),
      prisma.francoEspecial.count({ where: { colaboradorId: id } }),
      prisma.weeklyWip.count({ where: { colaboradorId: id } }),
      prisma.carryover.count({ where: { colaboradorId: id } }),
      prisma.crmActividad.count({ where: { colaboradorId: id } }),
      prisma.lead.count({ where: { ownerId: id } }),
      prisma.proyecto.count({ where: { ownerId: id } }),
    ]);
    const dependencias = { grilla, tareas, francos, wips, carryover, actividades, leads, proyectos };
    const tieneDatos = grilla + tareas + francos + wips + carryover + actividades + leads + proyectos > 0;
    if (tieneDatos && !force) {
      return res.status(409).json({ error: { code: 'tiene_dependencias', message: 'El colaborador tiene datos asociados', dependencias } });
    }
    await prisma.colaborador.delete({ where: { id } });
    res.json({ ok: true, eliminado: id, dependencias });
  } catch (e) { next(e); }
});

// --- Recursos con CRUD genérico ---
router.use('/colaboradores', crudRouter('colaborador', {
  orderBy: { nombre: 'asc' },
  include: { periodos: { orderBy: { desde: 'asc' } } },
  transformInput: colaboradorTransform,
  allowed: ['identitySub','tokenApp','tipo','nombre','email','sector','funcionCosto','iniciales','foto','haceGuardia','fechaIngreso','fechaSalida','periodos','cumpleDia','cumpleMes','activo'],
}));
// Sub-recurso: períodos del colaborador
router.get('/colaboradores/:id/periodos', async (req, res, next) => {
  try { res.json(await prisma.colaboradorPeriodo.findMany({ where: { colaboradorId: Number(req.params.id) }, orderBy: { desde: 'asc' } })); }
  catch (e) { next(e); }
});
router.post('/colaboradores/:id/periodos', async (req, res, next) => {
  try {
    const created = await prisma.colaboradorPeriodo.create({ data: {
      colaboradorId: Number(req.params.id), desde: new Date(req.body.desde),
      hasta: req.body.hasta ? new Date(req.body.hasta) : null } });
    res.status(201).json(created);
  } catch (e) { next(e); }
});
// Inactivación: baja lógica con fecha de salida obligatoria (no borra, conserva historia)
router.post('/colaboradores/:id/inactivar', async (req, res, next) => {
  try {
    if (!req.body.fecha) throw new ApiError(400, 'fecha_required', 'La fecha de salida es obligatoria');
    const updated = await prisma.colaborador.update({
      where: { id: Number(req.params.id) },
      data: { activo: false, fechaSalida: coerceFecha(req.body.fecha) },
      include: { periodos: { orderBy: { desde: 'asc' } } },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.use('/proyectos', crudRouter('proyecto', {
  orderBy: { createdAt: 'desc' },
  allowed: ['nombre','enfoque','estado','cliente','descripcion','ownerId','fechaInicio','fechaFin','inicioReal','cierreReal','objetivoId','leadId'],
  transformInput: (d) => {
    for (const k of ['fechaInicio','fechaFin','inicioReal','cierreReal']) if (k in d) d[k] = coerceFecha(d[k]);
    return d;
  },
}));

router.use('/tareas', tareasRouter);

router.use('/objetivos', crudRouter('objetivo', {
  orderBy: { codigo: 'asc' },
  allowed: ['codigo','titulo','descripcion','indicador','meta','peso','fechaEsperada','anio','enfoque','calculo','avanceManual','asignadosIds','asignadosExternos','asignadosTodos','depIt','comentarios','metaNumerica'],
  transformInput: (d) => {
    if ('fechaEsperada' in d) d.fechaEsperada = coerceFecha(d.fechaEsperada);
    if ('peso' in d && d.peso !== null && d.peso !== '') d.peso = Number(d.peso);
    if ('avanceManual' in d) d.avanceManual = (d.avanceManual === null || d.avanceManual === '') ? null : Number(d.avanceManual);
    return d;
  },
}));

router.use('/tags', crudRouter('tag', {
  orderBy: { nombre: 'asc' }, allowed: ['nombre','categoria','color'],
}));

router.use('/plantillas', crudRouter('plantilla', {
  orderBy: { producto: 'asc' }, allowed: ['nombre','producto','unidadLabel','etapas'],
}));

router.use('/clientes', crudRouter('cliente', {
  orderBy: { nombre: 'asc' },
  allowed: ['nombre','tipoCliente','razonSocial','cuit','direccion','localidad','ciudad','celular','emailFacturacion'],
}));

router.use('/guardias', guardiasRouter);
  router.use('/import', importarRouter);

router.use('/francos', crudRouter('francoEspecial', {
  orderBy: { fecha: 'asc' }, allowed: ['colaboradorId','fecha','tipo','motivo'],
  transformInput: (d) => { if ('fecha' in d) d.fecha = coerceFecha(d.fecha); return d; },
}));
router.use('/carryover', carryoverRouter);

router.use('/feriados', crudRouter('feriado', {
  orderBy: { fecha: 'asc' }, allowed: ['fecha','nombre'],
  transformInput: (d) => { if ('fecha' in d) d.fecha = coerceFecha(d.fecha); return d; },
}));

// --- Recursos a medida ---
router.use('/leads', leadsRouter);
router.use('/archivos', archivosRouter);
router.use('/grilla', grillaRouter);
// Asistente IA (Claude vía API; herramientas filtradas por rol adentro)
router.use('/asistente', asistenteRouter);
// Análisis: reportes agregados (permisos por tipo adentro del router)
router.use('/analisis', analisisRouter);
// Costos: solo rol gerencial/manager puede escribir; lectura para todos los habilitados
router.use('/costos', costosRouter);

export default router;

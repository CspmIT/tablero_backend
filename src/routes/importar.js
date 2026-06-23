import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

// --- helpers ---
const fecha = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const norm = (v) => String(v || '').trim().toLowerCase();

const TIPOS = new Set(['manager', 'gerencial', 'collaborator', 'externo', 'tercerizado']);
const tipoOf = (v) => {
  const t = norm(v).replace('colaborador', 'collaborator');
  return TIPOS.has(t) ? t : 'collaborator';
};
const ENFOQUES = new Set(['ORGANIZACION', 'ELECTRONICA', 'DESARROLLO_WEB', 'COMERCIALIZACION', 'OPERACION']);
const enfoqueOf = (v) => {
  if (!v) return null;
  const e = String(v).trim().toUpperCase().replace(/[\s-]+/g, '_')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ENFOQUES.has(e) ? e : null;
};
const ETAPAS = new Set(['contacto', 'visita_agendada', 'visita_realizada', 'propuesta', 'negociacion', 'trial', 'ganado', 'perdido']);
const etapaOf = (v) => (ETAPAS.has(norm(v)) ? norm(v) : 'contacto');
const COLS = new Set(['backlog', 'todo', 'doing', 'done']);
const colOf = (v) => (COLS.has(norm(v)) ? norm(v) : 'backlog');
const PRIOS = new Set(['baja', 'media', 'alta', 'urgente']);
const prioOf = (v) => (PRIOS.has(norm(v)) ? norm(v) : 'media');
const EST_PROY = new Set(['activo', 'pausado', 'cerrado']);
const estProyOf = (v) => (EST_PROY.has(norm(v)) ? norm(v) : 'activo');

function nuevoResultado() { return { creados: 0, errores: [] }; }
const arr = (x) => (Array.isArray(x) ? x : []);

// POST /import  — recibe el volcado de localStorage del standalone y lo carga.
router.post('/', async (req, res, next) => {
  try {
    const data = req.body || {};
    const r = {};
    const colabMap = {};   // idLocal -> idNuevo
    const objetivoMap = {};
    const tagMap = {};     // nombre -> idNuevo
    const leadMap = {};
    const proyectoMap = {};

    // 1) Colaboradores
    r.colaboradores = nuevoResultado();
    const cumples = data.cumples || {};
    // El usuario que dispara la importación es el "ancla" (su identidad en el tablero).
    // El colaborador del volcado marcado como usuario actual (data.me) NO se da de alta
    // de nuevo: se fusiona sobre el ancla. Así sus vínculos (grilla, proyectos, tareas)
    // caen sobre el usuario existente y no se genera un duplicado.
    const anclaId = req.colaborador?.id || null;
    const meLocal = data.me || null;
    for (const c of arr(data.collaborators)) {
      try {
        const cm = cumples[c.id] || c.cumple || '';
        const [mm, dd] = String(cm).split('-').map((x) => parseInt(x, 10));
        const periodos = arr(c.periodos)
          .map((p) => ({ desde: fecha(p.desde || p.entra || p.inicio), hasta: fecha(p.hasta || p.sale || p.fin) }))
          .filter((p) => p.desde);
        const datos = {
          nombre: c.name || c.nombre || 'Sin nombre',
          iniciales: c.initials || c.iniciales || null,
          tipo: tipoOf(c.role || c.tipo),
          sector: c.sector || null,
          email: c.email || null,
          foto: c.foto || null,
          haceGuardia: !!(c.does_guardia ?? c.haceGuardia),
          fechaIngreso: fecha(c.fecha_ingreso || c.fechaIngreso),
          fechaSalida: fecha(c.fecha_salida || c.fechaSalida),
          cumpleMes: Number.isInteger(mm) ? mm : null,
          cumpleDia: Number.isInteger(dd) ? dd : null,
          activo: c.activo !== false,
        };
        if (anclaId && meLocal && c.id === meLocal) {
          // Fusión sobre el ancla: actualiza sus datos y reemplaza sus períodos.
          await prisma.colaboradorPeriodo.deleteMany({ where: { colaboradorId: anclaId } });
          await prisma.colaborador.update({
            where: { id: anclaId },
            data: { ...datos, periodos: { create: periodos } },
          });
          colabMap[c.id] = anclaId;
        } else {
          const creado = await prisma.colaborador.create({
            data: { ...datos, periodos: { create: periodos } },
          });
          colabMap[c.id] = creado.id;
        }
        r.colaboradores.creados++;
      } catch (e) { r.colaboradores.errores.push(`${c.id || c.name}: ${e.message}`); }
    }

    // 2) Clientes (Proyecto.cliente es texto; guardamos el catálogo)
    r.clientes = nuevoResultado();
    for (const cl of arr(data.clientes)) {
      try { await prisma.cliente.create({ data: { nombre: cl.nombre || cl.name || 'Cliente', tipoCliente: cl.tipo || cl.tipoCliente || null } }); r.clientes.creados++; }
      catch (e) { r.clientes.errores.push(`${cl.nombre}: ${e.message}`); }
    }

    // 3) Tags
    r.tags = nuevoResultado();
    for (const t of arr(data.tags_registry)) {
      const nombre = t.nombre || t.name || t.label || t.id;
      if (!nombre) continue;
      try {
        const creado = await prisma.tag.upsert({ where: { nombre }, update: {}, create: { nombre, categoria: t.categoria || t.category || null, color: t.color || null } });
        tagMap[nombre] = creado.id; r.tags.creados++;
      } catch (e) { r.tags.errores.push(`${nombre}: ${e.message}`); }
    }

    // 4) Objetivos
    r.objetivos = nuevoResultado();
    for (const o of arr(data.objetivos)) {
      try {
        const codigo = o.codigo || o.id;
        const datos = {
          titulo: o.titulo || o.nombre || codigo || 'Objetivo',
          descripcion: o.descripcion || null,
          indicador: o.indicador || null,
          meta: o.meta != null ? String(o.meta) : null,
          peso: num(o.peso),
          enfoque: enfoqueOf(o.enfoque),
          calculo: ['manual', 'por_tags', 'por_actividad'].includes(norm(o.calculo)) ? norm(o.calculo) : 'manual',
          asignadosTodos: !!o.asignadosTodos,
        };
        const creado = await prisma.objetivo.upsert({
          where: { codigo },
          update: datos,
          create: { codigo, ...datos },
        });
        objetivoMap[o.id] = creado.id; r.objetivos.creados++;
      } catch (e) { r.objetivos.errores.push(`${o.id}: ${e.message}`); }
    }

    // 5) Feriados (mapa fecha -> nombre)
    r.feriados = nuevoResultado();
    for (const [f, nombre] of Object.entries(data.feriados || {})) {
      const d = fecha(f); if (!d) continue;
      try { await prisma.feriado.upsert({ where: { fecha: d }, update: { nombre: String(nombre) }, create: { fecha: d, nombre: String(nombre) } }); r.feriados.creados++; }
      catch (e) { r.feriados.errores.push(`${f}: ${e.message}`); }
    }

    // 6) Plantillas
    r.plantillas = nuevoResultado();
    for (const p of arr(data.plantillas)) {
      const producto = p.producto || p.id;
      try { await prisma.plantilla.upsert({ where: { producto }, update: {}, create: { nombre: p.nombre || producto, producto, unidadLabel: p.unidad_label || p.unidadLabel || 'unidad', etapas: p.etapas || [] } }); r.plantillas.creados++; }
      catch (e) { r.plantillas.errores.push(`${producto}: ${e.message}`); }
    }

    // 7) Leads
    r.leads = nuevoResultado();
    for (const l of arr(data.leads)) {
      try {
        const creado = await prisma.lead.create({
          data: {
            contactoNombre: l.contacto_nombre || l.contactoNombre || null,
            organizacion: l.organizacion || 'Sin organización',
            telefono: l.telefono || null,
            email: l.email || null,
            ciudad: l.ciudad || null,
            fechaPrimerContacto: fecha(l.fecha_primer_contacto),
            ownerId: colabMap[l.owner_id] || null,
            etapa: etapaOf(l.column || l.etapa),
            valorEstimadoUsd: num(l.valor_estimado_usd ?? l.valor_usd),
            montoFacturadoUsd: num(l.monto_facturado_usd),
            cantidadEquipos: num(l.cant_equipos) != null ? Math.round(num(l.cant_equipos)) : null,
            equiposDetalle: l.equipos_detalle || null,
            proximaAccion: l.prox_accion || null,
            proximaAccionFecha: fecha(l.prox_accion_fecha),
            motivoPerdido: l.motivo_perdido || null,
            notas: l.notas || null,
            fuente: l.fuente || null,
            fuenteOtra: l.fuente_otra || null,
            trialVence: fecha(l.trial_vence),
            trialNotas: l.trial_notas || null,
            presupuestoEnviadoFecha: fecha(l.pres_enviado_fecha),
            presupuestoAprobadoFecha: fecha(l.pres_aprobado_fecha),
            presupuestoLink: l.pres_link || null,
            presupuestoEstado: l.presupuesto_estado ?? null,
            presupuestoAguaEstado: l.presupuesto_agua_estado ?? l.agua_estado ?? null,
            coopcloudEstado: l.coopcloud_estado ?? null,
            productos: { create: arr(l.productos).filter(Boolean).map((p) => ({ producto: String(p) })) },
          },
        });
        leadMap[l.id] = creado.id; r.leads.creados++;
      } catch (e) { r.leads.errores.push(`${l.id || l.organizacion}: ${e.message}`); }
    }

    // 8) Proyectos
    r.proyectos = nuevoResultado();
    for (const p of arr(data.proyectos)) {
      try {
        const creado = await prisma.proyecto.create({
          data: {
            nombre: p.nombre || p.cliente || 'Proyecto',
            cliente: p.cliente || null,
            enfoque: enfoqueOf(p.enfoque),
            estado: estProyOf(p.estado),
            ownerId: colabMap[p.owner_id] || null,
            objetivoId: objetivoMap[p.objetivo_id] || null,
            leadId: leadMap[p.lead_id] || null,
          },
        });
        proyectoMap[p.id] = creado.id; r.proyectos.creados++;
      } catch (e) { r.proyectos.errores.push(`${p.id || p.nombre}: ${e.message}`); }
    }

    // 9) Tareas (kanban_cards)
    r.tareas = nuevoResultado();
    for (const k of arr(data.kanban_cards)) {
      try {
        const responsables = arr(k.owners_ids).map((id) => colabMap[id]).filter(Boolean);
        const tagsIds = arr(k.tags).map((t) => tagMap[t]).filter(Boolean);
        await prisma.tarea.create({
          data: {
            titulo: k.title || k.titulo || 'Tarea',
            descripcion: k.description || k.descripcion || null,
            kanbanCol: colOf(k.column || k.kanbanCol),
            prioridad: prioOf(k.priority || k.prioridad),
            weight: num(k.weight) != null ? Math.round(num(k.weight)) : 1,
            pct: num(k.pct) != null ? Math.round(num(k.pct)) : null,
            fechaInicio: fecha(k.fecha_inicio),
            fechaFin: fecha(k.fecha_fin),
            startedAt: fecha(k.started_at),
            closedAt: fecha(k.closed_at),
            unidades: k.unidades ?? null,
            proyectoId: proyectoMap[k.proyecto_id] || null,
            responsables: { create: responsables.map((cid) => ({ colaboradorId: cid })) },
            tags: { create: tagsIds.map((tid) => ({ tagId: tid })) },
          },
        });
        r.tareas.creados++;
      } catch (e) { r.tareas.errores.push(`${k.id || k.title}: ${e.message}`); }
    }

    // 10) Grilla (entries: mapa `${collabId}:${ISO}` -> entry)
    r.grilla = nuevoResultado();
    for (const [key, e] of Object.entries(data.entries || {})) {
      const [localCid, iso] = key.split(':');
      const cid = colabMap[localCid]; const d = fecha(iso);
      if (!cid || !d || !e?.status) continue;
      try {
        await prisma.grillaEntrada.create({
          data: {
            colaboradorId: cid, fecha: d, estado: e.status,
            entryTime: e.entry_time || null, viajeLabel: e.viaje_label || null,
            items: Array.isArray(e.items) ? e.items : [], horasExtra: e.horas_extra || null,
          },
        });
        r.grilla.creados++;
      } catch (er) { r.grilla.errores.push(`${key}: ${er.message}`); }
    }

    // 11) WIP semanal (mapa weekKey `${collabId}:${anio}-W${semana}` -> texto)
    r.wips = nuevoResultado();
    for (const [key, texto] of Object.entries(data.weekly_wips || {})) {
      const m = String(key).match(/^(.+):(\d{4})-W(\d{1,2})$/);
      if (!m) continue;
      const cid = colabMap[m[1]];
      if (!cid || !texto) continue;
      try { await prisma.weeklyWip.create({ data: { colaboradorId: cid, anio: Number(m[2]), semanaIso: Number(m[3]), texto: String(texto) } }); r.wips.creados++; }
      catch (e) { r.wips.errores.push(`${key}: ${e.message}`); }
    }

    // 12) Guardias (rotación) — { [`${anio}-W${week}`]: { asignaciones } } o array
    r.guardias = nuevoResultado();
    const guardiasSrc = data.guardias || {};
    const guardiasArr = Array.isArray(guardiasSrc)
      ? guardiasSrc
      : Object.entries(guardiasSrc).map(([k, v]) => {
          const mm = String(k).match(/(\d{4}).*?(\d{1,2})$/);
          return { anio: mm ? Number(mm[1]) : null, week: mm ? Number(mm[2]) : null, asignaciones: v?.asignaciones ?? v };
        });
    for (const g of guardiasArr) {
      const anio = num(g.anio); const week = num(g.week);
      if (anio == null || week == null) continue;
      try { await prisma.guardiaSemana.create({ data: { anio: Math.round(anio), week: Math.round(week), asignaciones: g.asignaciones ?? {} } }); r.guardias.creados++; }
      catch (e) { r.guardias.errores.push(`${anio}-W${week}: ${e.message}`); }
    }

    // 13) Francos especiales
    r.francos = nuevoResultado();
    for (const f of arr(data.francos_especiales)) {
      const cid = colabMap[f.colaborador_id || f.collab_id || f.colaboradorId]; const d = fecha(f.fecha);
      if (!cid || !d) continue;
      try { await prisma.francoEspecial.create({ data: { colaboradorId: cid, fecha: d, motivo: f.motivo || null } }); r.francos.creados++; }
      catch (e) { r.francos.errores.push(`${f.fecha}: ${e.message}`); }
    }

    // 14) Carryover (mapa collabId -> dias | { anio: dias })
    r.carryover = nuevoResultado();
    const anioActual = new Date().getFullYear();
    for (const [localCid, val] of Object.entries(data.carryover || {})) {
      const cid = colabMap[localCid]; if (!cid) continue;
      const entradas = (val && typeof val === 'object') ? Object.entries(val).map(([a, d]) => ({ anio: Number(a) || anioActual, dias: num(d) })) : [{ anio: anioActual, dias: num(val) }];
      for (const en of entradas) {
        if (en.dias == null) continue;
        try { await prisma.carryover.create({ data: { colaboradorId: cid, anio: en.anio, dias: en.dias } }); r.carryover.creados++; }
        catch (e) { r.carryover.errores.push(`${localCid}/${en.anio}: ${e.message}`); }
      }
    }

    // 15) Costos (mapa mes -> { costo_laboral, cotizacion_dolar, asignaciones }) con remapeo de ids en asignaciones
    r.costos = nuevoResultado();
    for (const [mes, md] of Object.entries(data.costos || {})) {
      if (!/^\d{4}-\d{2}$/.test(mes)) continue;
      let asign = null;
      if (md?.asignaciones && typeof md.asignaciones === 'object') {
        asign = {};
        for (const [localCid, a] of Object.entries(md.asignaciones)) {
          const cid = colabMap[localCid]; if (cid) asign[cid] = a;
        }
      }
      try {
        const datos = { costoLaboral: num(md?.costo_laboral ?? md?.costoLaboral), cotizacionDolar: num(md?.cotizacion_dolar ?? md?.cotizacionDolar), asignaciones: asign };
        await prisma.costoMensual.upsert({ where: { mes }, update: datos, create: { mes, ...datos } });
        r.costos.creados++;
      } catch (e) { r.costos.errores.push(`${mes}: ${e.message}`); }
    }

    const totalCreados = Object.values(r).reduce((s, x) => s + x.creados, 0);
    const totalErrores = Object.values(r).reduce((s, x) => s + x.errores.length, 0);
    res.json({ ok: true, totalCreados, totalErrores, detalle: r });
  } catch (e) { next(e); }
});

// Blanquea TODA la base, para reimportar desde cero y detectar datos espurios.
// Borra en orden hijos -> padres dentro de una transacción. Acción destructiva:
// requiere body { confirmar: 'BLANQUEAR' }.
router.post('/reset', async (req, res, next) => {
  try {
    if (req.body?.confirmar !== 'BLANQUEAR') {
      return res.status(400).json({ error: { code: 'confirmacion_requerida', message: 'Falta la confirmación para blanquear la base' } });
    }
    const orden = [
      'tareaResponsable', 'tareaTag', 'objetivoTag', 'objetivoAporteActividad', 'leadProducto',
      'crmActividad', 'archivo', 'grillaEntrada', 'weeklyWip', 'carryover', 'francoEspecial',
      'colaboradorPeriodo', 'guardiaSemana', 'tarea', 'proyecto', 'lead', 'objetivo', 'tag',
      'cliente', 'feriado', 'costoMensual', 'plantilla', 'colaborador',
    ];
    const borrados = {};
    // Preservamos la fila del usuario ancla (quien dispara el blanqueo): se borran
    // todas sus dependencias (grilla, períodos, etc.), pero su identidad persiste para
    // poder reimportar y fusionar sobre él los datos del volcado.
    const anclaId = req.colaborador?.id || null;
    await prisma.$transaction(async (tx) => {
      for (const modelo of orden) {
        const res = (modelo === 'colaborador' && anclaId)
          ? await tx.colaborador.deleteMany({ where: { id: { not: anclaId } } })
          : await tx[modelo].deleteMany({});
        borrados[modelo] = res.count;
      }
    });
    const total = Object.values(borrados).reduce((s, n) => s + n, 0);
    res.json({ ok: true, total, borrados });
  } catch (e) { next(e); }
});

export default router;

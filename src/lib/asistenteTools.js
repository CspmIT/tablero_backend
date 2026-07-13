// Herramientas del asistente IA. Claude decide cuáles invocar; el backend es el
// ÚNICO que toca la base, y filtra por rol: las herramientas sensibles no se
// declaran (ni se ejecutan) para tipos sin permiso.
//
// Convención de horas desde la grilla: un día trabajado (present/home_office/viaje)
// equivale a 8 hs repartidas en partes iguales entre los ítems válidos del día
// (mismo criterio que fmtWipHours del tablero). Es una estimación declarada.
import { prisma } from './prisma.js';

const HORAS_DIA = 8;
const DIAS_TRABAJADOS = ['present', 'home_office', 'viaje'];

const toDate = (v) => new Date(typeof v === 'string' && v.length === 10 ? v + 'T00:00:00Z' : v);
// Último instante del mes en UTC (las fechas de la grilla son @db.Date = medianoche UTC).
const finDeMes = (mes) => {
  const [y, m] = String(mes).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59)); // día 0 del mes siguiente = último día del mes
};

// --- Definiciones (formato tools de la API de Anthropic) + ejecutores --------

const TOOLS = [
  {
    roles: null, // null = todos los aprovisionados
    def: {
      name: 'listar_colaboradores',
      description: 'Lista los colaboradores del equipo Cooptech: id, nombre, sector, tipo y si está activo. Usala para resolver nombres a ids antes de otras consultas.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    run: async () => {
      const data = await prisma.colaborador.findMany({
        select: { id: true, nombre: true, sector: true, tipo: true, activo: true },
        orderBy: { nombre: 'asc' },
      });
      return data;
    },
  },
  {
    roles: null,
    def: {
      name: 'horas_por_etiqueta',
      description: `Estima horas de trabajo por etiqueta (tag) a partir de la grilla diaria, en un rango de fechas. Criterio: cada día trabajado = ${HORAS_DIA} hs repartidas en partes iguales entre los ítems del día; las horas de un ítem se asignan a cada una de sus etiquetas. Sirve para preguntas como "¿cuántas horas se destinaron a Reconecta este año?" (las etiquetas suelen ser productos o proyectos). Devuelve horas por etiqueta y total de días trabajados. SIEMPRE aclarar en la respuesta que es una estimación con este criterio.`,
      input_schema: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
          colaboradorId: { type: 'number', description: 'Opcional: limitar a un colaborador' },
        },
        required: ['desde', 'hasta'],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const where = { fecha: { gte: toDate(input.desde), lte: toDate(input.hasta) } };
      if (input.colaboradorId) where.colaboradorId = Number(input.colaboradorId);
      const entradas = await prisma.grillaEntrada.findMany({
        where, select: { estado: true, items: true, colaboradorId: true },
      });
      const horasPorTag = {}; const horasSinTag = { horas: 0 };
      let diasTrabajados = 0;
      for (const e of entradas) {
        if (!DIAS_TRABAJADOS.includes(e.estado)) continue;
        const items = (Array.isArray(e.items) ? e.items : []).filter(i => i && String(i.text || '').trim());
        diasTrabajados += 1;
        if (!items.length) continue;
        const horasItem = HORAS_DIA / items.length;
        for (const it of items) {
          const tags = Array.isArray(it.tags) ? it.tags : [];
          if (!tags.length) { horasSinTag.horas += horasItem; continue; }
          for (const t of tags) {
            const k = String(t);
            horasPorTag[k] = (horasPorTag[k] || 0) + horasItem;
          }
        }
      }
      const redondear = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
      return {
        criterio: `estimación: ${HORAS_DIA} hs por día trabajado, repartidas entre los ítems del día`,
        diasTrabajados,
        horasPorEtiqueta: redondear(horasPorTag),
        horasSinEtiqueta: Math.round(horasSinTag.horas * 10) / 10,
      };
    },
  },
  {
    roles: null,
    def: {
      name: 'tareas_kanban',
      description: 'Lista tareas (cards) del kanban con título, columna (backlog/todo/doing/done), prioridad, % de avance, peso, fecha límite, proyecto, responsables y etiquetas. Filtros opcionales por colaborador responsable, columna o proyecto.',
      input_schema: {
        type: 'object',
        properties: {
          colaboradorId: { type: 'number' },
          columna: { type: 'string', enum: ['backlog', 'todo', 'doing', 'done'] },
          proyectoId: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const where = {};
      if (input.columna) where.kanbanCol = input.columna;
      if (input.proyectoId) where.proyectoId = Number(input.proyectoId);
      if (input.colaboradorId) where.responsables = { some: { colaboradorId: Number(input.colaboradorId) } };
      const data = await prisma.tarea.findMany({
        where,
        orderBy: [{ kanbanCol: 'asc' }, { orden: 'asc' }],
        take: 200,
        include: {
          proyecto: { select: { id: true, nombre: true, objetivoId: true } },
          responsables: { include: { colaborador: { select: { id: true, nombre: true } } } },
          tags: { include: { tag: { select: { nombre: true } } } },
        },
      });
      return data.map(t => ({
        id: t.id, titulo: t.titulo, columna: t.kanbanCol, prioridad: t.prioridad,
        pct: t.pct, weight: t.weight,
        fechaFin: t.fechaFin ? t.fechaFin.toISOString().slice(0, 10) : null,
        proyecto: t.proyecto ? { id: t.proyecto.id, nombre: t.proyecto.nombre, objetivoId: t.proyecto.objetivoId } : null,
        responsables: t.responsables.map(r => r.colaborador?.nombre).filter(Boolean),
        tags: t.tags.map(x => x.tag?.nombre).filter(Boolean),
      }));
    },
  },
  {
    roles: null,
    def: {
      name: 'wip_actual',
      description: 'Trabajo en curso de un colaborador: sus tareas en columna "doing" y su foco declarado de la semana (WIP semanal). Usala antes de sugerir una próxima tarea.',
      input_schema: {
        type: 'object',
        properties: { colaboradorId: { type: 'number' } },
        required: ['colaboradorId'],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const id = Number(input.colaboradorId);
      const doing = await prisma.tarea.findMany({
        where: { kanbanCol: 'doing', responsables: { some: { colaboradorId: id } } },
        select: { id: true, titulo: true, pct: true, fechaFin: true, prioridad: true },
      });
      const hoy = new Date();
      // Semana ISO de hoy
      const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const anio = d.getUTCFullYear();
      const semanaIso = Math.ceil((((d - Date.UTC(anio, 0, 1)) / 86400000) + 1) / 7);
      const wip = await prisma.weeklyWip.findFirst({ where: { colaboradorId: id, anio, semanaIso } });
      return {
        enCurso: doing.map(t => ({ ...t, fechaFin: t.fechaFin ? t.fechaFin.toISOString().slice(0, 10) : null })),
        focoSemana: wip?.texto || null,
      };
    },
  },
  {
    roles: null,
    def: {
      name: 'objetivos',
      description: 'Lista los objetivos (OKR) del año: código, título, indicador, meta, peso, modo de cálculo y avance manual si lo tiene. Útil para evaluar el aporte de una tarea o proyecto a los objetivos.',
      input_schema: {
        type: 'object',
        properties: { anio: { type: 'number', description: 'Opcional; por defecto todos' } },
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const where = {};
      if (input.anio) where.anio = Number(input.anio);
      return prisma.objetivo.findMany({
        where, orderBy: { codigo: 'asc' },
        select: { id: true, codigo: true, titulo: true, indicador: true, meta: true, peso: true, anio: true, calculo: true, avanceManual: true },
      });
    },
  },
  {
    roles: null,
    def: {
      name: 'pipeline_crm',
      description: 'Estado del embudo comercial: leads por etapa (contacto, visita_agendada, visita_realizada, propuesta, negociacion, trial, ganado, perdido) con organización, productos, valor en USD y próxima acción. Incluye totales por etapa.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    run: async () => {
      const leads = await prisma.lead.findMany({
        select: {
          id: true, organizacion: true, etapa: true, valorUsd: true,
          proxAccion: true, proxAccionFecha: true,
          productos: { select: { producto: true } },
        },
        orderBy: { updatedAt: 'desc' }, take: 300,
      });
      const porEtapa = {};
      for (const l of leads) {
        const e = l.etapa;
        porEtapa[e] = porEtapa[e] || { cantidad: 0, valorUsd: 0 };
        porEtapa[e].cantidad += 1;
        porEtapa[e].valorUsd += Number(l.valorUsd || 0);
      }
      return {
        totalesPorEtapa: porEtapa,
        leads: leads.map(l => ({
          organizacion: l.organizacion, etapa: l.etapa, valorUsd: Number(l.valorUsd || 0),
          productos: l.productos.map(p => p.producto),
          proxAccion: l.proxAccion,
          proxAccionFecha: l.proxAccionFecha ? l.proxAccionFecha.toISOString().slice(0, 10) : null,
        })),
      };
    },
  },
  {
    roles: ['manager', 'gerencial', 'externo'],
    def: {
      name: 'horas_extra_mes',
      description: 'Horas extra registradas en la grilla, agrupadas por colaborador, para un mes dado. Dato exacto (cada registro tiene hora de ingreso, salida y duración). Solo disponible para perfiles habilitados.',
      input_schema: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mes YYYY-MM' } },
        required: ['mes'],
        additionalProperties: false,
      },
    },
    run: async (input) => resumenHorasExtra(input.mes),
  },
  {
    roles: ['manager', 'gerencial'],
    def: {
      name: 'costos_mensuales',
      description: 'Insumos de costos de un mes (metodología CPN): costo laboral total en ARS y cotización del dólar registrada. Solo manager/gerencial.',
      input_schema: {
        type: 'object',
        properties: { mes: { type: 'string', description: 'Mes YYYY-MM' } },
        required: ['mes'],
        additionalProperties: false,
      },
    },
    run: async (input) => {
      const c = await prisma.costoMensual.findUnique({ where: { mes: String(input.mes) } });
      if (!c) return { mes: input.mes, cargado: false };
      return {
        mes: c.mes, cargado: true,
        costoLaboralARS: c.costoLaboral != null ? Number(c.costoLaboral) : null,
        cotizacionDolar: c.cotizacionDolar != null ? Number(c.cotizacionDolar) : null,
      };
    },
  },
];

// --- Resumen de horas extra (compartido con la solapa Análisis) -------------
export async function resumenHorasExtra(mes) {
  const desde = toDate(`${mes}-01`);
  const hasta = finDeMes(mes);
  const entradas = await prisma.grillaEntrada.findMany({
    where: { fecha: { gte: desde, lte: hasta }, NOT: { horasExtra: { equals: null } } },
    select: { colaboradorId: true, fecha: true, horasExtra: true },
    orderBy: { fecha: 'asc' },
  });
  const colaboradores = await prisma.colaborador.findMany({
    select: { id: true, nombre: true, sector: true },
  });
  const nombrePor = Object.fromEntries(colaboradores.map(c => [c.id, c]));
  const porColaborador = {};
  for (const e of entradas) {
    const he = e.horasExtra;
    const horas = Number(he?.horas || 0);
    if (!horas) continue;
    const k = e.colaboradorId;
    porColaborador[k] = porColaborador[k] || {
      colaboradorId: k,
      nombre: nombrePor[k]?.nombre || `#${k}`,
      sector: nombrePor[k]?.sector || null,
      totalHoras: 0,
      dias: [],
    };
    porColaborador[k].totalHoras += horas;
    porColaborador[k].dias.push({
      fecha: e.fecha.toISOString().slice(0, 10),
      ingreso: he?.ingreso || null,
      salida: he?.salida || null,
      horas,
    });
  }
  const filas = Object.values(porColaborador)
    .map(f => ({ ...f, totalHoras: Math.round(f.totalHoras * 10) / 10 }))
    .sort((a, b) => b.totalHoras - a.totalHoras);
  return {
    mes,
    totalGeneral: Math.round(filas.reduce((s, f) => s + f.totalHoras, 0) * 10) / 10,
    colaboradores: filas,
  };
}

// Herramientas visibles para un tipo de colaborador dado.
export function toolsParaTipo(tipo) {
  return TOOLS.filter(t => !t.roles || t.roles.includes(tipo));
}

// Ejecuta una herramienta por nombre, re-verificando el permiso (defensa doble).
export async function ejecutarTool(nombre, input, tipo) {
  const tool = TOOLS.find(t => t.def.name === nombre);
  if (!tool) return { error: `Herramienta desconocida: ${nombre}` };
  if (tool.roles && !tool.roles.includes(tipo)) {
    return { error: 'Sin permiso para esta consulta con tu perfil.' };
  }
  try {
    return await tool.run(input || {});
  } catch (e) {
    return { error: `Error al consultar: ${e.message}` };
  }
}

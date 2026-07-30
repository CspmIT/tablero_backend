// Solapa "Análisis": reportes agregados sobre datos existentes.
// Primer reporte: horas extra por colaborador con selector de mes.
// Visible para manager, gerencial y externo (otras áreas, ej. RRHH).
import { Router } from 'express';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { resumenHorasExtra } from '../lib/asistenteTools.js';

const router = Router();

router.use(requireTipo('manager', 'gerencial', 'externo'));

// GET /analisis/horas-extra?mes=YYYY-MM
router.get('/horas-extra', async (req, res, next) => {
  try {
    const mes = String(req.query.mes || '');
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      throw new ApiError(400, 'bad_request', 'Indicá el mes en formato YYYY-MM');
    }
    res.json(await resumenHorasExtra(mes));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// OCIOSIDAD ANUAL POR COLABORADOR (26/07) — jornada de 8 hs.
// Semisuma calendario: sábados + domingos + feriados en día hábil.
// Semisuma personal: vacaciones + francos (incl. cumpleaños) + licencias
// (estados de la grilla; el estado "feriado" NO se cuenta acá para no duplicar
// con la tabla de feriados). Rango: la vigencia del colaborador (períodos)
// intersecada con el año; el año en curso se cuenta HASTA HOY.
import { prisma } from '../lib/prisma.js';

const JORNADA = 8;
const dia = (d) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z');

router.get('/ociosidad', async (req, res, next) => {
  try {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const desdeAnio = new Date(Date.UTC(anio, 0, 1));
    const hoy = dia(new Date());
    const finAnio = new Date(Date.UTC(anio, 11, 31));
    const hastaAnio = (anio === hoy.getUTCFullYear() && hoy < finAnio) ? hoy : finAnio;

    // Solo perfiles INTERNOS del área (gerenciales, externos y tercerizados
    // distorsionan las métricas de capacidad). Se incluyen INACTIVOS cuya
    // vigencia (períodos) toca el año — p.ej. una baja de mitad de año cuenta
    // su ociosidad hasta la baja.
    const [colaboradores, periodos, feriados, entradas] = await Promise.all([
      prisma.colaborador.findMany({ where: { tipo: { in: ['manager', 'collaborator'] } }, select: { id: true, nombre: true, activo: true }, orderBy: { nombre: 'asc' } }),
      prisma.colaboradorPeriodo.findMany(),
      prisma.feriado.findMany({ where: { fecha: { gte: desdeAnio, lte: hastaAnio } } }),
      prisma.grillaEntrada.findMany({
        where: {
          fecha: { gte: desdeAnio, lte: hastaAnio },
          estado: { in: ['vacaciones', 'franco', 'franco_cumple', 'licencia'] },
        },
        select: { colaboradorId: true, estado: true },
      }),
    ]);

    const feriadosHabiles = new Set(
      feriados.filter(f => { const dow = new Date(f.fecha).getUTCDay(); return dow !== 0 && dow !== 6; })
        .map(f => f.fecha.toISOString().slice(0, 10)));

    const porColabPeriodos = {};
    for (const p of periodos) (porColabPeriodos[p.colaboradorId] ||= []).push(p);

    const filas = colaboradores.map((c) => {
      // Con períodos: tramos = intersección con el año (si no tocan el año, la
      // fila se descarta más abajo). Sin períodos cargados: solo los ACTIVOS
      // cuentan (todo el año); un inactivo sin períodos no es fechable.
      const tienePeriodos = !!porColabPeriodos[c.id];
      if (!tienePeriodos && !c.activo) return null;
      const tramos = (porColabPeriodos[c.id] || [{ desde: desdeAnio, hasta: null }])
        .map(p => ({
          desde: new Date(Math.max(dia(new Date(p.desde)), desdeAnio)),
          hasta: new Date(Math.min(p.hasta ? dia(new Date(p.hasta)) : hastaAnio, hastaAnio)),
        }))
        .filter(t => t.desde <= t.hasta);

      const mios = entradas.filter(e => e.colaboradorId === c.id);
      let findes = 0, fers = 0;
      for (const t of tramos) {
        for (let d = new Date(t.desde); d <= t.hasta; d.setUTCDate(d.getUTCDate() + 1)) {
          const dow = d.getUTCDay();
          if (dow === 0 || dow === 6) findes++;
          else if (feriadosHabiles.has(d.toISOString().slice(0, 10))) fers++;
        }
      }
      const vac = mios.filter(e => e.estado === 'vacaciones').length;
      const fra = mios.filter(e => e.estado === 'franco' || e.estado === 'franco_cumple').length;
      const lic = mios.filter(e => e.estado === 'licencia').length;

      // Sin vigencia en el año y sin registros personales → fuera de la tabla.
      if (tienePeriodos && tramos.length === 0 && mios.length === 0) return null;
      const semiCalendario = (findes + fers) * JORNADA;
      const semiPersonal = (vac + fra + lic) * JORNADA;
      return {
        colaboradorId: c.id, nombre: c.nombre,
        horasFinde: findes * JORNADA, horasFeriados: fers * JORNADA, semisumaCalendario: semiCalendario,
        horasVacaciones: vac * JORNADA, horasFrancos: fra * JORNADA, horasLicencias: lic * JORNADA,
        semisumaPersonal: semiPersonal,
        total: semiCalendario + semiPersonal,
      };
    }).filter(Boolean);
    res.json({ anio, hasta: hastaAnio.toISOString().slice(0, 10), jornada: JORNADA, colaboradores: filas });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// EXPLORADOR DE ETIQUETAS COMBINADAS (26/07) — AND / intersección de conjuntos.
// El ítem cuenta si tiene TODAS las etiquetas pedidas (clave normalizada).
// Años y colaboradores actúan como "tags virtuales" (filtros del mismo AND).
// Solo suman las HORAS DECLARADAS (misma convención que /etiquetas/detalle);
// los ítems de la combinación sin horas se informan aparte.
const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

router.get('/tags-combo', async (req, res, next) => {
  try {
    const tags = String(req.query.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const anios = String(req.query.anios || '').split(',').map(Number).filter(Boolean);
    const colabs = String(req.query.colaboradores || '').split(',').map(Number).filter(Boolean);
    if (!tags.length && !anios.length && !colabs.length) {
      throw new ApiError(400, 'bad_request', 'Elegí al menos una etiqueta, año o colaborador');
    }
    const claves = tags.map(normalizar);

    const where = { NOT: { items: { equals: null } } };
    if (anios.length) where.fecha = {
      gte: new Date(Date.UTC(Math.min(...anios), 0, 1)),
      lte: new Date(Date.UTC(Math.max(...anios), 11, 31)),
    };
    if (colabs.length) where.colaboradorId = { in: colabs };

    const [entradas, nombres] = await Promise.all([
      prisma.grillaEntrada.findMany({ where, select: { colaboradorId: true, fecha: true, items: true } }),
      prisma.colaborador.findMany({ select: { id: true, nombre: true } }),
    ]);
    const nombreDe = Object.fromEntries(nombres.map(c => [c.id, c.nombre]));
    const setAnios = new Set(anios);

    let totalHoras = 0, nItems = 0, sinHoras = 0;
    const porColab = {}, porAnio = {};
    for (const e of entradas) {
      const a = e.fecha.getUTCFullYear();
      if (setAnios.size && !setAnios.has(a)) continue;
      for (const it of (Array.isArray(e.items) ? e.items : [])) {
        const propias = new Set((Array.isArray(it?.tags) ? it.tags : []).map(normalizar));
        if (!claves.every(k => propias.has(k))) continue;
        nItems++;
        const h = Number(it?.horas) > 0 ? Number(it.horas) : 0;
        if (!h) { sinHoras++; continue; }
        totalHoras += h;
        (porColab[e.colaboradorId] ||= { horas: 0, items: 0 });
        porColab[e.colaboradorId].horas += h; porColab[e.colaboradorId].items++;
        (porAnio[a] ||= { horas: 0, items: 0 });
        porAnio[a].horas += h; porAnio[a].items++;
      }
    }
    const round = (x) => Math.round(x * 100) / 100;
    res.json({
      seleccion: { tags, anios, colaboradores: colabs },
      totalHoras: round(totalHoras),
      items: nItems,
      itemsSinHoras: sinHoras,
      personas: Object.keys(porColab).length,
      porColaborador: Object.entries(porColab)
        .map(([id, v]) => ({ colaboradorId: Number(id), nombre: nombreDe[id] || `#${id}`, horas: round(v.horas), items: v.items }))
        .sort((a, b) => b.horas - a.horas),
      porAnio: Object.entries(porAnio)
        .map(([a, v]) => ({ anio: Number(a), horas: round(v.horas), items: v.items }))
        .sort((a, b) => a.anio - b.anio),
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// ROTACIÓN DE PERSONAL (26/07) — activos, altas y bajas por mes, desde los
// períodos de vigencia (ColaboradorPeriodo). Colaborador sin períodos = activo
// en todo el rango (histórico previo a la carga de períodos, sin eventos).
// GET /analisis/rotacion?desde=YYYY-MM&hasta=YYYY-MM
router.get('/rotacion', async (req, res, next) => {
  try {
    const rx = /^\d{4}-\d{2}$/;
    const hoyMes = new Date().toISOString().slice(0, 7);
    const hasta = rx.test(req.query.hasta) ? req.query.hasta : hoyMes;
    const desde = rx.test(req.query.desde) ? req.query.desde
      : `${Number(hasta.slice(0, 4)) - 1}-${hasta.slice(5)}`; // default: 12 meses
    if (desde > hasta) throw new ApiError(400, 'bad_request', 'El mes de inicio es posterior al de fin');

    // Solo internos del área (la rotación de gerenciales/externos no es
    // rotación del equipo). Inactivos incluidos: sus bajas SON la rotación.
    const [colaboradores, periodos] = await Promise.all([
      prisma.colaborador.findMany({ where: { tipo: { in: ['manager', 'collaborator'] } }, select: { id: true, nombre: true } }),
      prisma.colaboradorPeriodo.findMany(),
    ]);
    const idsInternos = new Set(colaboradores.map(c => c.id));
    const porColab = {};
    for (const p of periodos) { if (idsInternos.has(p.colaboradorId)) (porColab[p.colaboradorId] ||= []).push(p); }

    const meses = [];
    let [y, m] = desde.split('-').map(Number);
    while (`${y}-${String(m).padStart(2, '0')}` <= hasta && meses.length < 240) {
      const mesKey = `${y}-${String(m).padStart(2, '0')}`;
      const ini = new Date(Date.UTC(y, m - 1, 1));
      const fin = new Date(Date.UTC(y, m, 0));
      let activos = 0, altas = 0, bajas = 0;
      for (const c of colaboradores) {
        const ps = porColab[c.id];
        if (!ps) { activos++; continue; } // sin períodos: activo siempre, sin eventos
        let activoEsteMes = false;
        for (const p of ps) {
          const d = new Date(p.desde), h = p.hasta ? new Date(p.hasta) : null;
          if (d <= fin && (!h || h >= ini)) activoEsteMes = true;
          if (d >= ini && d <= fin) altas++;
          if (h && h >= ini && h <= fin) bajas++;
        }
        if (activoEsteMes) activos++;
      }
      meses.push({ mes: mesKey, activos, altas, bajas });
      m++; if (m > 12) { m = 1; y++; }
    }
    // Promedio anual de activos del último año calendario completo del rango.
    res.json({ desde, hasta, meses });
  } catch (e) { next(e); }
});

// Años con datos en la grilla (para los chips de año autogenerados).
router.get('/rango-anios', async (req, res, next) => {
  try {
    const [min, max] = await Promise.all([
      prisma.grillaEntrada.findFirst({ orderBy: { fecha: 'asc' }, select: { fecha: true } }),
      prisma.grillaEntrada.findFirst({ orderBy: { fecha: 'desc' }, select: { fecha: true } }),
    ]);
    const anios = [];
    if (min && max) {
      for (let a = max.fecha.getUTCFullYear(); a >= min.fecha.getUTCFullYear(); a--) anios.push(a);
    }
    res.json({ anios });
  } catch (e) { next(e); }
});

export default router;

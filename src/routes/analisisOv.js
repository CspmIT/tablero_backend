// Métricas Oficina Virtual (ola 1, 18/08) — pedido de Gerencia de Operaciones.
// Diseño congelado: OficinaVirtual_tickets_diseno_18_08.md (proyecto).
// Unidad de análisis: 1 ítem de grilla = 1 ticket (D1). Clasificación en DOS
// ejes (D2): tipo (incidente|solicitud) × causa (4 del pedido). La
// clasificación viaja ADENTRO del ítem Json de GrillaEntrada.items — SIN
// migración, cero riesgo sobre datos cargados. Valores como STRING, no enum
// (lección del 06/08: la trampa del enum).
// Candidatos: tags ⊇ {Oficina Virtual, Coopmorteros} = DIRECTO; solo
// {Coopmorteros} = A VALIDAR (comparación sin tildes ni mayúsculas).
// Horas por ticket (decisión Leonardo 18/08): REALES si el ítem tiene `horas`
// cargadas; el remanente de la jornada (8h + horas extra) se PRORRATEA entre
// los ítems del día sin horas. Es estimación y así se declara en la UI.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { getConfig, setConfig } from '../lib/config.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

// Vista ejecutiva: manager + gerencial (decisión Leonardo 18/08). La
// clasificación desde el editor del día NO pasa por acá (va por el PUT normal
// de grilla), así los colaboradores clasifican sin ver este tablero.
// 19/08 (pedido de Leonardo): los colaboradores INTERNOS del área también ven
// y clasifican (les había habilitado la vista desde permisos pero el backend
// les devolvía 403 → "todo vacío"). Externos y tercerizados siguen afuera.
// Editar las REGLAS de sugerencia queda para manager/gerencial (abajo).
router.use(requireTipo('manager', 'gerencial', 'collaborator'));

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const TAG_OV = 'oficina virtual';
const TAG_COOP = 'coopmorteros';
const TIPOS = ['incidente', 'solicitud'];
const CAUSAS = ['ov_interna', 'interna_otra', 'procoop', 'terceros'];
const nuevoId = () => 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const toDate = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);

// GET /analisis/ov/tickets?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve los ítems candidatos del rango con su clasificación y horas
// (reales o prorrateadas). El tablero agrega en el frontend (mismo criterio
// que Ingresos). Además ASIGNA id estable a los ítems que no lo tengan
// (migración al leer — regla dura nº1 del diseño: el id jamás se regenera).
router.get('/tickets', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.desde || req.query.hasta) {
      where.fecha = {};
      if (req.query.desde) where.fecha.gte = toDate(req.query.desde);
      if (req.query.hasta) where.fecha.lte = toDate(req.query.hasta);
    }
    const entradas = await prisma.grillaEntrada.findMany({ where, orderBy: { fecha: 'asc' } });
    const colabs = await prisma.colaborador.findMany({ select: { id: true, nombre: true } });
    const nombreDe = new Map(colabs.map((c) => [c.id, c.nombre]));

    const tickets = [];
    for (const e of entradas) {
      const items = Array.isArray(e.items) ? e.items : [];
      if (!items.length) continue;

      // Migración al leer: id estable para todo ítem-objeto que no lo tenga.
      // SOLO agrega el campo id — no toca nada más del ítem (auditable).
      let dirty = false;
      const conId = items.map((it) => {
        if (it && typeof it === 'object' && !it.id) { dirty = true; return { ...it, id: nuevoId() }; }
        return it;
      });
      if (dirty) {
        await prisma.grillaEntrada.update({ where: { id: e.id }, data: { items: conId } });
      }

      const validos = conId.filter((it) => it && typeof it === 'object' && String(it.text || '').trim());
      if (!validos.length) continue;

      // Jornada del día = 8h + horas extra cargadas (horasExtra.horas).
      const extra = (e.horasExtra && typeof e.horasExtra === 'object') ? (Number(e.horasExtra.horas) || 0) : 0;
      const jornada = 8 + extra;
      const horasCargadas = validos.reduce((a, it) => a + (Number(it.horas) > 0 ? Number(it.horas) : 0), 0);
      const sinHoras = validos.filter((it) => !(Number(it.horas) > 0)).length;
      const prorrateo = sinHoras > 0 ? Math.max(0, jornada - horasCargadas) / sinHoras : 0;

      for (const it of validos) {
        const tags = (Array.isArray(it.tags) ? it.tags : []).map(norm);
        const esOV = tags.includes(TAG_OV) && tags.includes(TAG_COOP);
        const esCoop = !esOV && tags.includes(TAG_COOP);
        if (!esOV && !esCoop) continue;
        tickets.push({
          entradaId: e.id,
          itemId: it.id,
          fecha: e.fecha,
          colaboradorId: e.colaboradorId,
          colaborador: nombreDe.get(e.colaboradorId) || `#${e.colaboradorId}`,
          text: it.text,
          tags: Array.isArray(it.tags) ? it.tags : [],
          wip: !!it.wip,
          horas: Number(it.horas) > 0 ? Number(it.horas) : Math.round(prorrateo * 100) / 100,
          horasReales: Number(it.horas) > 0,
          directo: esOV, // false = candidato "a validar" (solo Coopmorteros)
          ovTipo: it.ovTipo ?? null,
          ovCausa: it.ovCausa ?? null,
          ovDescartado: it.ovDescartado === true,
          ovPor: it.ovPor ?? null,
          ovFecha: it.ovFecha ?? null,
        });
      }
    }
    res.json({ tickets, tipos: TIPOS, causas: CAUSAS });
  } catch (e) { next(e); }
});

// Modifica UN ítem por id dentro de la entrada — merge puntual, jamás
// reemplazo del array (regla dura nº2 del diseño).
async function tocarItem(entradaId, itemId, mod) {
  const e = await prisma.grillaEntrada.findUnique({ where: { id: Number(entradaId) } });
  if (!e) throw new ApiError(404, 'not_found', 'Entrada de grilla no encontrada');
  const items = Array.isArray(e.items) ? e.items : [];
  let hallado = false;
  const nuevos = items.map((it) => {
    if (it && typeof it === 'object' && it.id === itemId) { hallado = true; return mod(it); }
    return it;
  });
  if (!hallado) throw new ApiError(404, 'not_found', 'Ítem no encontrado en la entrada (recargá el tablero)');
  await prisma.grillaEntrada.update({ where: { id: e.id }, data: { items: nuevos } });
}

// PUT /analisis/ov/clasificar  { entradaId, itemId, tipo, causa }
router.put('/clasificar', async (req, res, next) => {
  try {
    const { entradaId, itemId, tipo, causa } = req.body || {};
    if (!entradaId || !itemId) throw new ApiError(400, 'bad_request', 'Faltan entradaId / itemId');
    if (!TIPOS.includes(tipo)) throw new ApiError(400, 'bad_request', 'tipo inválido (incidente|solicitud)');
    if (!CAUSAS.includes(causa)) throw new ApiError(400, 'bad_request', 'causa inválida');
    await tocarItem(entradaId, itemId, (it) => ({
      ...it,
      ovTipo: tipo,
      ovCausa: causa,
      ovDescartado: false,
      ovPor: req.colaborador?.nombre ?? null,
      ovFecha: new Date().toISOString().slice(0, 10),
    }));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /analisis/ov/descartar  { entradaId, itemId, descartado? }  (reversible)
router.put('/descartar', async (req, res, next) => {
  try {
    const { entradaId, itemId } = req.body || {};
    const descartado = req.body?.descartado !== false; // default true
    if (!entradaId || !itemId) throw new ApiError(400, 'bad_request', 'Faltan entradaId / itemId');
    await tocarItem(entradaId, itemId, (it) => ({
      ...it,
      ovDescartado: descartado,
      ovPor: req.colaborador?.nombre ?? null,
      ovFecha: new Date().toISOString().slice(0, 10),
    }));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Reglas de sugerencia por palabras clave — editable desde la app, sin
// redeploy (patrón multivac_botones / plantilla_sensor). El motor corre en el
// frontend; acá solo se persisten.
// ---------------------------------------------------------------------------
const CLAVE_REGLAS = 'ov_reglas_clasificacion';
const MAX_REGLAS = 100;
const REGLAS_DEFAULT = [
  { contiene: 'procoop', tipo: '', causa: 'procoop' },
  { contiene: 'cashpower', tipo: '', causa: 'terceros' },
  { contiene: 'boton de pago', tipo: '', causa: 'terceros' },
  { contiene: 'pasarela', tipo: '', causa: 'terceros' },
  { contiene: 'pago', tipo: '', causa: 'terceros' },
  { contiene: 'error', tipo: 'incidente', causa: '' },
  { contiene: 'falla', tipo: 'incidente', causa: '' },
  { contiene: 'no funciona', tipo: 'incidente', causa: '' },
  { contiene: 'caido', tipo: 'incidente', causa: '' },
  { contiene: 'no anda', tipo: 'incidente', causa: '' },
  { contiene: 'capacitacion', tipo: 'solicitud', causa: 'interna_otra' },
  { contiene: 'relevamiento', tipo: 'solicitud', causa: 'interna_otra' },
  { contiene: 'alta de usuario', tipo: 'solicitud', causa: 'ov_interna' },
  { contiene: 'blanqueo', tipo: 'solicitud', causa: 'ov_interna' },
];

router.get('/reglas', async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_REGLAS);
    let reglas = REGLAS_DEFAULT;
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) reglas = p; } catch { /* defaults */ } }
    res.json({ reglas });
  } catch (e) { next(e); }
});

router.put('/reglas', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const entrada = req.body?.reglas;
    if (!Array.isArray(entrada)) throw new ApiError(400, 'bad_request', 'Se espera { reglas: [...] }');
    if (entrada.length > MAX_REGLAS) throw new ApiError(400, 'bad_request', `Máximo ${MAX_REGLAS} reglas`);
    const reglas = entrada
      .map((r) => ({
        contiene: String(r?.contiene || '').trim().slice(0, 80),
        tipo: TIPOS.includes(r?.tipo) ? r.tipo : '',
        causa: CAUSAS.includes(r?.causa) ? r.causa : '',
      }))
      .filter((r) => r.contiene && (r.tipo || r.causa));
    await setConfig(CLAVE_REGLAS, JSON.stringify(reglas));
    res.json({ reglas });
  } catch (e) { next(e); }
});

export default router;

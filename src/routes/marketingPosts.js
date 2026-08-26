// Calendario de publicaciones de Marketing (ola 3, 21/08).
// El espacio de trabajo del mes: los ítems que Booster lleva en el excel
// (día/canal/formato/título/copy) viven acá y el frontend los pinta como
// calendario. Espacio COMPARTIDO del equipo (mismo espíritu que la grilla):
// todo el interno crea, edita y borra. 24/08 (decisión de Leonardo, llegada de
// Booster): también 'tercerizado' — la planificación la arman ellas; la solapa
// Marketing se otorga por el panel (extra por id) y acá el backend acompaña.
// El calendario no contiene datos sensibles (títulos/copys de publicaciones),
// así que abrirlo al TIPO no expone nada de los tercerizados de LV Redes.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireTipo('manager', 'gerencial', 'collaborator', 'tercerizado'));

const MES_RE = /^\d{4}-\d{2}$/;
const CANALES = ['feed', 'historia', 'linkedin', 'mailing'];
const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;

// Ids de archivos saneados para el vínculo (dedupe, enteros, tope defensivo).
const sanearArchivoIds = (v) => {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 30);
};

// GET /marketing-posts?mes=YYYY-MM — cada post trae sus archivoIds vinculados.
router.get('/', async (req, res, next) => {
  try {
    const mes = String(req.query.mes || '');
    if (!MES_RE.test(mes)) throw new ApiError(400, 'bad_request', 'Falta ?mes=YYYY-MM');
    const filas = await prisma.marketingPost.findMany({
      where: { mes },
      orderBy: [{ dia: 'asc' }, { id: 'asc' }],
      include: { archivos: { select: { archivoId: true } } },
    });
    res.json({ posts: filas.map(({ archivos, ...p }) => ({ ...p, archivoIds: archivos.map((a) => a.archivoId) })) });
  } catch (e) { next(e); }
});

// GET /marketing-posts/archivos-usados — TODOS los archivoIds vinculados a alguna
// publicación (cualquier mes): el sello «usado» del contenido. Literal ANTES
// de /:id (lección 05/08 — acá no choca porque /:id es solo PATCH/DELETE, pero
// la regla se respeta igual).
router.get('/archivos-usados', async (req, res, next) => {
  try {
    // «Usado» = vinculado a una publicación O a una campaña (26/08).
    const [dePosts, deCamps] = await Promise.all([
      prisma.marketingPostArchivo.findMany({ select: { archivoId: true }, distinct: ['archivoId'] }),
      prisma.marketingCampaniaArchivo.findMany({ select: { archivoId: true }, distinct: ['archivoId'] }),
    ]);
    res.json({ archivoIds: [...new Set([...dePosts, ...deCamps].map((f) => f.archivoId))] });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// CAMPAÑAS publicitarias (26/08): estrategia Meta Ads con período que se dibuja
// como línea en el calendario. Pocas por año ⇒ el GET devuelve TODAS (el
// frontend filtra por intersección con el mes visible — el período puede
// cruzar meses: 20/08 → 10/09). Literales ANTES de /:id (lección 05/08).
// ---------------------------------------------------------------------------
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fechaDe = (v) => (v && FECHA_RE.test(String(v)) ? new Date(`${v}T12:00:00.000Z`) : null);
const conArchivoIds = ({ archivos, ...c }) => ({ ...c, archivoIds: (archivos || []).map((a) => a.archivoId) });

router.get('/campanias', async (req, res, next) => {
  try {
    const filas = await prisma.marketingCampania.findMany({
      orderBy: [{ desde: 'asc' }, { id: 'desc' }],
      include: { archivos: { select: { archivoId: true } } },
    });
    res.json({ campanias: filas.map(conArchivoIds) });
  } catch (e) { next(e); }
});

router.post('/campanias', async (req, res, next) => {
  try {
    const b = req.body || {};
    const nombre = limpiar(b.nombre);
    if (!nombre) throw new ApiError(400, 'bad_request', 'Falta el nombre de la campaña');
    const desde = fechaDe(b.desde), hasta = fechaDe(b.hasta);
    if ((desde && !hasta) || (!desde && hasta)) throw new ApiError(400, 'bad_request', 'El período necesita desde Y hasta');
    if (desde && hasta && hasta < desde) throw new ApiError(400, 'bad_request', 'hasta no puede ser anterior a desde');
    const archivoIds = sanearArchivoIds(b.archivoIds);
    const c = await prisma.marketingCampania.create({
      data: {
        nombre,
        producto: limpiar(b.producto, 60),
        presupuesto: limpiar(b.presupuesto),
        desarrollo: String(b.desarrollo || '').trim() || null,
        aprobada: Boolean(b.aprobada),
        desde, hasta,
        creadoPorId: req.colaborador?.id ?? null,
        archivos: { create: archivoIds.map((archivoId) => ({ archivoId })) },
      },
    });
    res.status(201).json({ ...c, archivoIds });
  } catch (e) { next(e); }
});

router.patch('/campanias/:id', async (req, res, next) => {
  try {
    const c = await prisma.marketingCampania.findUnique({ where: { id: Number(req.params.id) } });
    if (!c) throw new ApiError(404, 'not_found', 'Campaña no encontrada');
    const b = req.body || {};
    const data = {};
    if (b.nombre !== undefined) data.nombre = limpiar(b.nombre) || c.nombre;
    if (b.producto !== undefined) data.producto = limpiar(b.producto, 60);
    if (b.presupuesto !== undefined) data.presupuesto = limpiar(b.presupuesto);
    if (b.desarrollo !== undefined) data.desarrollo = String(b.desarrollo || '').trim() || null;
    if (b.aprobada !== undefined) data.aprobada = Boolean(b.aprobada);
    if (b.desde !== undefined) data.desde = b.desde === null ? null : fechaDe(b.desde);
    if (b.hasta !== undefined) data.hasta = b.hasta === null ? null : fechaDe(b.hasta);
    const desdeFin = data.desde !== undefined ? data.desde : c.desde;
    const hastaFin = data.hasta !== undefined ? data.hasta : c.hasta;
    if ((desdeFin && !hastaFin) || (!desdeFin && hastaFin)) throw new ApiError(400, 'bad_request', 'El período necesita desde Y hasta (o ninguno)');
    if (desdeFin && hastaFin && hastaFin < desdeFin) throw new ApiError(400, 'bad_request', 'hasta no puede ser anterior a desde');
    if (b.archivoIds !== undefined) {
      const ids = sanearArchivoIds(b.archivoIds);
      // Reemplazo del set de piezas: deleteMany acotado a ESTA campaña (mismo patrón que los posts).
      data.archivos = { deleteMany: {}, create: ids.map((archivoId) => ({ archivoId })) };
    }
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar');
    const r = await prisma.marketingCampania.update({
      where: { id: c.id }, data,
      include: { archivos: { select: { archivoId: true } } },
    });
    res.json(conArchivoIds(r));
  } catch (e) { next(e); }
});

router.delete('/campanias/:id', async (req, res, next) => {
  try {
    const c = await prisma.marketingCampania.findUnique({ where: { id: Number(req.params.id) } });
    if (!c) throw new ApiError(404, 'not_found', 'Campaña no encontrada');
    await prisma.marketingCampania.delete({ where: { id: c.id } }); // vínculos caen por cascade
    res.status(204).end();
  } catch (e) { next(e); }
});

// POST /marketing-posts { mes, dia?, canal, formato?, titulo, nota?, aprobada? }
// dia null/ausente = IDEA sin fecha (26/08): vive en la bandeja hasta programarse.
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const mes = String(b.mes || '');
    const dia = b.dia === null || b.dia === undefined || b.dia === '' ? null : Number(b.dia);
    const canal = String(b.canal || '').toLowerCase();
    const titulo = limpiar(b.titulo);
    if (!MES_RE.test(mes)) throw new ApiError(400, 'bad_request', 'mes inválido (YYYY-MM)');
    if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) throw new ApiError(400, 'bad_request', 'dia inválido (1..31 o null para idea)');
    if (!CANALES.includes(canal)) throw new ApiError(400, 'bad_request', `canal inválido (${CANALES.join('|')})`);
    if (!titulo) throw new ApiError(400, 'bad_request', 'Falta el título');
    const archivoIds = sanearArchivoIds(b.archivoIds);
    const post = await prisma.marketingPost.create({
      data: {
        mes, dia, canal, titulo,
        formato: limpiar(b.formato, 60),
        nota: String(b.nota || '').trim() || null,
        aprobada: Boolean(b.aprobada),
        creadoPorId: req.colaborador?.id ?? null,
        archivos: { create: archivoIds.map((archivoId) => ({ archivoId })) },
      },
    });
    res.status(201).json({ ...post, archivoIds });
  } catch (e) { next(e); }
});

// PATCH /marketing-posts/:id — edición de cualquier campo del ítem.
router.patch('/:id', async (req, res, next) => {
  try {
    const p = await prisma.marketingPost.findUnique({ where: { id: Number(req.params.id) } });
    if (!p) throw new ApiError(404, 'not_found', 'Ítem no encontrado');
    const b = req.body || {};
    const data = {};
    if (b.mes !== undefined) {
      if (!MES_RE.test(String(b.mes))) throw new ApiError(400, 'bad_request', 'mes inválido');
      data.mes = String(b.mes);
    }
    if (b.dia !== undefined) {
      // null = volver a la bandeja de ideas; 1..31 = programar en el calendario.
      const d = b.dia === null || b.dia === '' ? null : Number(b.dia);
      if (d !== null && (!Number.isInteger(d) || d < 1 || d > 31)) throw new ApiError(400, 'bad_request', 'dia inválido');
      data.dia = d;
    }
    if (b.aprobada !== undefined) data.aprobada = Boolean(b.aprobada);
    if (b.canal !== undefined) {
      const c = String(b.canal || '').toLowerCase();
      if (!CANALES.includes(c)) throw new ApiError(400, 'bad_request', 'canal inválido');
      data.canal = c;
    }
    if (b.titulo !== undefined) data.titulo = limpiar(b.titulo) || p.titulo;
    if (b.formato !== undefined) data.formato = limpiar(b.formato, 60);
    if (b.nota !== undefined) data.nota = String(b.nota || '').trim() || null;
    // Vínculos a archivos: el set nuevo REEMPLAZA al viejo (deleteMany acotado a
    // los vínculos de ESTE post — mismo patrón que los mensajes del ticket).
    if (b.archivoIds !== undefined) {
      const ids = sanearArchivoIds(b.archivoIds);
      data.archivos = { deleteMany: {}, create: ids.map((archivoId) => ({ archivoId })) };
    }
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar');
    const actualizado = await prisma.marketingPost.update({
      where: { id: p.id }, data,
      include: { archivos: { select: { archivoId: true } } },
    });
    const { archivos, ...resto } = actualizado;
    res.json({ ...resto, archivoIds: archivos.map((a) => a.archivoId) });
  } catch (e) { next(e); }
});

// DELETE /marketing-posts/:id — un solo ítem, sin hijos (delete puntual).
router.delete('/:id', async (req, res, next) => {
  try {
    const p = await prisma.marketingPost.findUnique({ where: { id: Number(req.params.id) } });
    if (!p) throw new ApiError(404, 'not_found', 'Ítem no encontrado');
    await prisma.marketingPost.delete({ where: { id: p.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;

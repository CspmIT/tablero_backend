// Calendario de publicaciones de Marketing (ola 3, 21/08).
// El espacio de trabajo del mes: los ítems que Booster lleva en el excel
// (día/canal/formato/título/copy) viven acá y el frontend los pinta como
// calendario. Espacio COMPARTIDO del equipo (mismo espíritu que la grilla):
// todo el interno crea, edita y borra; los externos/tercerizados no entran
// (cuando Booster tenga usuarios, se revisa este guard).
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireTipo('manager', 'gerencial', 'collaborator'));

const MES_RE = /^\d{4}-\d{2}$/;
const CANALES = ['feed', 'historia', 'linkedin', 'mailing'];
const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;

// GET /marketing-posts?mes=YYYY-MM
router.get('/', async (req, res, next) => {
  try {
    const mes = String(req.query.mes || '');
    if (!MES_RE.test(mes)) throw new ApiError(400, 'bad_request', 'Falta ?mes=YYYY-MM');
    const posts = await prisma.marketingPost.findMany({ where: { mes }, orderBy: [{ dia: 'asc' }, { id: 'asc' }] });
    res.json({ posts });
  } catch (e) { next(e); }
});

// POST /marketing-posts { mes, dia, canal, formato?, titulo, nota? }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const mes = String(b.mes || '');
    const dia = Number(b.dia);
    const canal = String(b.canal || '').toLowerCase();
    const titulo = limpiar(b.titulo);
    if (!MES_RE.test(mes)) throw new ApiError(400, 'bad_request', 'mes inválido (YYYY-MM)');
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new ApiError(400, 'bad_request', 'dia inválido (1..31)');
    if (!CANALES.includes(canal)) throw new ApiError(400, 'bad_request', `canal inválido (${CANALES.join('|')})`);
    if (!titulo) throw new ApiError(400, 'bad_request', 'Falta el título');
    const post = await prisma.marketingPost.create({
      data: {
        mes, dia, canal, titulo,
        formato: limpiar(b.formato, 60),
        nota: String(b.nota || '').trim() || null,
        creadoPorId: req.colaborador?.id ?? null,
      },
    });
    res.status(201).json(post);
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
      const d = Number(b.dia);
      if (!Number.isInteger(d) || d < 1 || d > 31) throw new ApiError(400, 'bad_request', 'dia inválido');
      data.dia = d;
    }
    if (b.canal !== undefined) {
      const c = String(b.canal || '').toLowerCase();
      if (!CANALES.includes(c)) throw new ApiError(400, 'bad_request', 'canal inválido');
      data.canal = c;
    }
    if (b.titulo !== undefined) data.titulo = limpiar(b.titulo) || p.titulo;
    if (b.formato !== undefined) data.formato = limpiar(b.formato, 60);
    if (b.nota !== undefined) data.nota = String(b.nota || '').trim() || null;
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar');
    res.json(await prisma.marketingPost.update({ where: { id: p.id }, data }));
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

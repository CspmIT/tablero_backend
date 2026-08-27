// Agenda de contactos externos (26/08, pedido de Leonardo): para invitar a
// reuniones sin tipear el mail cada vez. DOS fuentes en una sola lista:
//   · MANUALES: la tabla Contacto (alta/edición/borrado desde la sección).
//   · CRM (en vivo): el contacto de cada lead con mail o teléfono — derivado
//     al momento, SIN copiar filas: si el lead corrige el mail, acá se ve solo.
// Interno solamente (agenda de la unidad; los tercerizados no la necesitan).
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireTipo('manager', 'gerencial', 'collaborator'));

const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;

// GET /contactos — manuales ∪ derivados del CRM, listos para el picker.
router.get('/', async (req, res, next) => {
  try {
    const [manuales, leads] = await Promise.all([
      prisma.contacto.findMany({ orderBy: { nombre: 'asc' } }),
      prisma.lead.findMany({
        where: { OR: [{ email: { not: null } }, { telefono: { not: null } }] },
        select: { id: true, organizacion: true, contactoNombre: true, email: true, telefono: true, cargo: true, etapa: true },
      }),
    ]);
    const contactos = [
      ...manuales.map((c) => ({ ...c, origen: 'manual' })),
      ...leads
        .filter((l) => (l.email || '').trim() || (l.telefono || '').trim())
        .map((l) => ({
          id: `lead_${l.id}`, leadId: l.id, origen: 'crm',
          nombre: l.contactoNombre || l.organizacion || `Lead #${l.id}`,
          email: l.email || null, telefono: l.telefono || null,
          organizacion: l.organizacion || null, cargo: l.cargo || null, notas: null,
        })),
    ];
    res.json({ contactos });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const nombre = limpiar(b.nombre);
    if (!nombre) throw new ApiError(400, 'bad_request', 'Falta el nombre');
    const c = await prisma.contacto.create({
      data: {
        nombre,
        email: limpiar(b.email),
        telefono: limpiar(b.telefono),
        organizacion: limpiar(b.organizacion),
        cargo: limpiar(b.cargo),
        notas: String(b.notas || '').trim() || null,
        creadoPorId: req.colaborador?.id ?? null,
      },
    });
    res.status(201).json({ ...c, origen: 'manual' });
  } catch (e) { next(e); }
});

// PATCH/DELETE solo sobre los MANUALES (los del CRM se editan en su lead).
router.patch('/:id', async (req, res, next) => {
  try {
    const c = await prisma.contacto.findUnique({ where: { id: Number(req.params.id) } });
    if (!c) throw new ApiError(404, 'not_found', 'Contacto no encontrado');
    const b = req.body || {};
    const data = {};
    if (b.nombre !== undefined) data.nombre = limpiar(b.nombre) || c.nombre;
    for (const k of ['email', 'telefono', 'organizacion', 'cargo']) {
      if (b[k] !== undefined) data[k] = limpiar(b[k]);
    }
    if (b.notas !== undefined) data.notas = String(b.notas || '').trim() || null;
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar');
    res.json({ ...(await prisma.contacto.update({ where: { id: c.id }, data })), origen: 'manual' });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const c = await prisma.contacto.findUnique({ where: { id: Number(req.params.id) } });
    if (!c) throw new ApiError(404, 'not_found', 'Contacto no encontrado');
    await prisma.contacto.delete({ where: { id: c.id } }); // puntual, sin hijos
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;

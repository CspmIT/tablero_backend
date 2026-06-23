import { Router } from 'express';
import { prisma } from './prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

// opts: { paginated, orderBy, allowed (campos aceptados en create/update),
//         include, transformInput, mapFilters }
export function crudRouter(modelName, opts = {}) {
  const router = Router();
  const model = prisma[modelName];
  if (!model) throw new Error(`Modelo Prisma desconocido: ${modelName}`);

  const pick = (body) => {
    if (!opts.allowed) return body;
    const out = {};
    for (const k of opts.allowed) if (k in body) out[k] = body[k];
    return out;
  };

  // Listar
  router.get('/', async (req, res, next) => {
    try {
      const where = opts.mapFilters ? opts.mapFilters(req.query) : {};
      const include = opts.include;
      const orderBy = opts.orderBy;
      if (opts.paginated) {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
        const [data, total] = await Promise.all([
          model.findMany({ where, include, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
          model.count({ where }),
        ]);
        return res.json({ data, pagination: { page, pageSize, total } });
      }
      const data = await model.findMany({ where, include, orderBy });
      res.json({ data });
    } catch (e) { next(e); }
  });

  // Crear
  router.post('/', async (req, res, next) => {
    try {
      let data = pick(req.body);
      if (opts.transformInput) data = await opts.transformInput(data, req);
      const created = await model.create({ data, include: opts.include });
      res.status(201).json(created);
    } catch (e) { next(e); }
  });

  // Obtener
  router.get('/:id', async (req, res, next) => {
    try {
      const found = await model.findUnique({ where: { id: Number(req.params.id) }, include: opts.include });
      if (!found) throw new ApiError(404, 'not_found', 'No encontrado');
      res.json(found);
    } catch (e) { next(e); }
  });

  // Actualizar (parcial)
  router.patch('/:id', async (req, res, next) => {
    try {
      let data = pick(req.body);
      if (opts.transformInput) data = await opts.transformInput(data, req);
      const updated = await model.update({ where: { id: Number(req.params.id) }, data, include: opts.include });
      res.json(updated);
    } catch (e) { next(e); }
  });

  // Eliminar
  router.delete('/:id', async (req, res, next) => {
    try {
      await model.delete({ where: { id: Number(req.params.id) } });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return router;
}

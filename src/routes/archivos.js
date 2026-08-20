import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

// Almacenamiento de archivos:
// El binario lo sube y lo lee directamente el FRONTEND contra el gateway de
// almacenamiento (storageov → MinIO). Acá sólo guardamos la REFERENCIA: el
// `key` (nombre del archivo en el bucket) junto con su metadata y el contexto
// (objetivo / lead) al que pertenece. La imagen se resuelve en el cliente con
// ese `key` mediante getImage().

// Listar referencias, filtrando por objetivo o lead (?objetivoId= / ?leadId=).
router.get('/', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.objetivoId) where.objetivoId = Number(req.query.objetivoId);
    if (req.query.leadId) where.leadId = Number(req.query.leadId);
    if (req.query.contexto) where.contexto = String(req.query.contexto);
    const data = await prisma.archivo.findMany({ where, orderBy: { createdAt: 'asc' } });
    res.json({ data });
  } catch (e) { next(e); }
});

// Registrar la referencia de un archivo que el frontend ya subió al gateway.
// Body (JSON): { key, nombre?, mime?, tamano?, gpsLat?, gpsLng?, esBoceto?,
//                leadId?, objetivoId?, contexto?, url? }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.key) throw new ApiError(422, 'validation', 'Falta "key" (nombre del archivo en el almacenamiento)');
    const archivo = await prisma.archivo.create({
      data: {
        key: String(b.key),
        url: b.url || null,
        nombre: b.nombre || String(b.key),
        mime: b.mime || null,
        tamano: b.tamano != null && b.tamano !== '' ? Number(b.tamano) : null,
        gpsLat: b.gpsLat != null && b.gpsLat !== '' ? Number(b.gpsLat) : null,
        gpsLng: b.gpsLng != null && b.gpsLng !== '' ? Number(b.gpsLng) : null,
        esBoceto: b.esBoceto === true || b.esBoceto === 'true',
        leadId: b.leadId != null && b.leadId !== '' ? Number(b.leadId) : null,
        objetivoId: b.objetivoId != null && b.objetivoId !== '' ? Number(b.objetivoId) : null,
        contexto: b.contexto || null,
      },
    });
    res.status(201).json(archivo);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
    if (!a) throw new ApiError(404, 'not_found', 'Archivo no encontrado');
    res.json(a);
  } catch (e) { next(e); }
});

// Actualización puntual de una referencia (18/08, biblioteca de Documentación
// de AutonomIA): mover un PDF de carpeta (la carpeta viaja en `url`) o
// retitularlo. Solo nombre y url — el binario en MinIO no se toca.
router.patch('/:id', async (req, res, next) => {
  try {
    const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
    if (!a) throw new ApiError(404, 'not_found', 'Archivo no encontrado');
    // En bibliotecas compartidas, ordenar/retitular es curaduría: manager/gerencial.
    // 20/08: mismo criterio para la sección Marketing (todos suben, la conducción cura).
    if (['multivac_doc', 'marketing'].includes(a.contexto) && !['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Solo manager/gerencial organiza la biblioteca compartida');
    }
    const data = {};
    if (req.body?.nombre !== undefined) data.nombre = String(req.body.nombre || '').trim().slice(0, 200) || a.nombre;
    if (req.body?.url !== undefined) data.url = req.body.url ? String(req.body.url).trim().slice(0, 200) : null;
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar (nombre y/o url)');
    const actualizado = await prisma.archivo.update({ where: { id: a.id }, data });
    res.json(actualizado);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
    if (!a) throw new ApiError(404, 'not_found', 'Archivo no encontrado');
    // Documentación compartida de AutonomIA (18/08) y Marketing (20/08): TODOS
    // pueden subir, pero eliminar de la biblioteca queda para manager/gerencial
    // (decisión de Leonardo — punto medio: cualquiera aporta, solo la conducción cura).
    if (['multivac_doc', 'marketing'].includes(a.contexto) && !['manager', 'gerencial'].includes(req.colaborador?.tipo)) {
      throw new ApiError(403, 'forbidden', 'Solo manager/gerencial puede eliminar de la biblioteca compartida');
    }
    // Sólo borramos la referencia en la base. El gateway de almacenamiento no
    // expone (todavía) un endpoint de borrado; si más adelante lo agrega, el
    // borrado del binario lo hace el frontend o se implementa aquí.
    await prisma.archivo.delete({ where: { id: a.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;

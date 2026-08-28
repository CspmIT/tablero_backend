// Laboratorio (28/08): funciones IoT migradas desde la Oficina Virtual —
// ABM de servidores InfluxDB/MQTT y COLA de solicitudes de borrado de datos.
// Esta ola guarda y audita; la EJECUCIÓN real contra Influx la conecta el
// equipo (proceso que lee las 'pendiente' y reporta por PATCH).
// Equipo interno solamente (decisión 28/08): manager + gerencial + collaborator.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireTipo('manager', 'gerencial', 'collaborator'));

const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;
const TIPOS = ['influx', 'mqtt'];
const ESTADOS_BORRADO = ['pendiente', 'ejecutado', 'error', 'cancelado'];

// buckets: acepta lista de strings o texto multilínea; devuelve lista limpia.
const normalizarBuckets = (v) => {
  const arr = Array.isArray(v) ? v : String(v || '').split(/\r?\n|,/);
  const out = [...new Set(arr.map((b) => String(b || '').trim()).filter(Boolean))];
  return out.length ? out.slice(0, 50) : null;
};
const fechaValida = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

// ---- Servidores -----------------------------------------------------------
// La contraseña SÍ viaja acá (decisión de Leonardo 28/08: herramienta de
// administración interna con 👁) — el guard de arriba es lo que la protege.
router.get('/servidores', async (req, res, next) => {
  try {
    const servidores = await prisma.labServidor.findMany({ orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
    res.json({ servidores });
  } catch (e) { next(e); }
});

router.post('/servidores', async (req, res, next) => {
  try {
    const b = req.body || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
    const nombre = limpiar(b.nombre);
    const url = limpiar(b.url, 500);
    if (!tipo) throw new ApiError(400, 'bad_request', 'Tipo inválido (influx | mqtt)');
    if (!nombre || !url) throw new ApiError(400, 'bad_request', 'Faltan nombre o URL');
    const s = await prisma.labServidor.create({
      data: {
        tipo, nombre, url,
        usuario: limpiar(b.usuario),
        contrasena: limpiar(b.contrasena, 500),
        puerto: Number.isFinite(Number(b.puerto)) && Number(b.puerto) > 0 ? Number(b.puerto) : null,
        buckets: tipo === 'influx' ? normalizarBuckets(b.buckets) : null,
      },
    });
    res.status(201).json(s);
  } catch (e) { next(e); }
});

router.patch('/servidores/:id', async (req, res, next) => {
  try {
    const s = await prisma.labServidor.findUnique({ where: { id: Number(req.params.id) } });
    if (!s) throw new ApiError(404, 'not_found', 'Servidor no encontrado');
    const b = req.body || {};
    const data = {};
    if (b.nombre !== undefined) data.nombre = limpiar(b.nombre) || s.nombre;
    if (b.url !== undefined) data.url = limpiar(b.url, 500) || s.url;
    if (b.usuario !== undefined) data.usuario = limpiar(b.usuario);
    // Contraseña: vacío al editar = CONSERVAR la actual (mismo criterio que la Mesa).
    if (b.contrasena !== undefined && String(b.contrasena).trim()) data.contrasena = limpiar(b.contrasena, 500);
    if (b.puerto !== undefined) data.puerto = Number.isFinite(Number(b.puerto)) && Number(b.puerto) > 0 ? Number(b.puerto) : null;
    if (b.buckets !== undefined && s.tipo === 'influx') data.buckets = normalizarBuckets(b.buckets);
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar');
    res.json(await prisma.labServidor.update({ where: { id: s.id }, data }));
  } catch (e) { next(e); }
});

router.delete('/servidores/:id', async (req, res, next) => {
  try {
    const s = await prisma.labServidor.findUnique({ where: { id: Number(req.params.id) } });
    if (!s) throw new ApiError(404, 'not_found', 'Servidor no encontrado');
    // El historial de borrados guarda los nombres como snapshot: sigue legible.
    await prisma.labServidor.delete({ where: { id: s.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---- Cola de borrados -----------------------------------------------------
router.get('/borrados', async (req, res, next) => {
  try {
    const borrados = await prisma.labBorrado.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ borrados });
  } catch (e) { next(e); }
});

// Crea la SOLICITUD (queda 'pendiente'; la ejecuta el proceso del área).
router.post('/borrados', async (req, res, next) => {
  try {
    const b = req.body || {};
    const desde = fechaValida(b.desde);
    const hasta = fechaValida(b.hasta);
    const bucket = limpiar(b.bucket);
    const topico = limpiar(b.topico, 500);
    if (!desde || !hasta) throw new ApiError(400, 'bad_request', 'Fechas de inicio y fin inválidas');
    if (hasta <= desde) throw new ApiError(400, 'bad_request', 'La fecha de fin debe ser posterior a la de inicio');
    if (!bucket || !topico) throw new ApiError(400, 'bad_request', 'Faltan bucket o tópico');
    const [mqtt, influx] = await Promise.all([
      b.servidorMqttId ? prisma.labServidor.findUnique({ where: { id: Number(b.servidorMqttId) } }) : null,
      b.servidorInfluxId ? prisma.labServidor.findUnique({ where: { id: Number(b.servidorInfluxId) } }) : null,
    ]);
    if (!mqtt) throw new ApiError(400, 'bad_request', 'Elegí el servidor MQTT');
    const creado = await prisma.labBorrado.create({
      data: {
        servidorMqttId: mqtt.id, servidorNombre: mqtt.nombre,
        servidorInfluxId: influx?.id ?? null, servidorInfluxNombre: influx?.nombre ?? null,
        bucket, topico, desde, hasta,
        solicitadoPorId: req.colaborador?.id ?? null,
        solicitadoPor: req.colaborador?.nombre ?? null,
      },
    });
    res.status(201).json(creado);
  } catch (e) { next(e); }
});

// PARA EL PROCESO EJECUTOR (y para marcar a mano si hace falta): reporta el
// resultado de una solicitud. Sella ejecutadoAt al pasar a ejecutado/error.
router.patch('/borrados/:id', async (req, res, next) => {
  try {
    const sol = await prisma.labBorrado.findUnique({ where: { id: Number(req.params.id) } });
    if (!sol) throw new ApiError(404, 'not_found', 'Solicitud no encontrada');
    const b = req.body || {};
    const data = {};
    if (b.estado !== undefined) {
      if (!ESTADOS_BORRADO.includes(b.estado)) throw new ApiError(400, 'bad_request', 'Estado inválido');
      data.estado = b.estado;
      if (['ejecutado', 'error'].includes(b.estado)) data.ejecutadoAt = new Date();
    }
    if (b.resultado !== undefined) data.resultado = String(b.resultado || '').trim() || null;
    if (!Object.keys(data).length) throw new ApiError(400, 'bad_request', 'Nada para actualizar');
    res.json(await prisma.labBorrado.update({ where: { id: sol.id }, data }));
  } catch (e) { next(e); }
});

// Cancelar una solicitud que TODAVÍA no se ejecutó (se elimina de la cola).
// Lo ya ejecutado es historial de auditoría: no se borra.
router.delete('/borrados/:id', async (req, res, next) => {
  try {
    const sol = await prisma.labBorrado.findUnique({ where: { id: Number(req.params.id) } });
    if (!sol) throw new ApiError(404, 'not_found', 'Solicitud no encontrada');
    if (sol.estado !== 'pendiente') throw new ApiError(400, 'bad_request', 'Solo se puede cancelar una solicitud pendiente');
    await prisma.labBorrado.delete({ where: { id: sol.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;

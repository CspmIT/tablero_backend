// Laboratorio (28/08): funciones IoT migradas desde la Oficina Virtual —
// ABM de servidores InfluxDB/MQTT y solicitudes de borrado de datos.
// 10/09: el borrado se EJECUTA al crearse (como la pantalla vieja de la OV):
// consulta → delete → reconsulta contra el servidor Influx guardado (lib/influx.js)
// y el resultado queda en la misma fila de LabBorrado (auditoría). Las que
// quedaron 'pendiente' de antes, o con 'error', se reintentan con /ejecutar.
// Equipo interno solamente (decisión 28/08): manager + gerencial + collaborator.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { ejecutarBorrado, InfluxError } from '../lib/influx.js';

const router = Router();
router.use(requireTipo('manager', 'gerencial', 'collaborator'));

const limpiar = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;
const TIPOS = ['influx', 'mqtt'];
// sin_datos (10/09): se ejecutó pero no había nada que borrar en el rango.
const ESTADOS_BORRADO = ['pendiente', 'ejecutado', 'sin_datos', 'error', 'cancelado'];

// Ejecuta la solicitud contra su servidor Influx y deja el resultado en la
// fila. Nunca lanza: cualquier falla queda como estado 'error' con un mensaje
// legible, para que el historial cuente qué pasó.
async function ejecutarSolicitud(sol) {
  const servidor = sol.servidorInfluxId
    ? await prisma.labServidor.findUnique({ where: { id: sol.servidorInfluxId } })
    : null;
  let r;
  if (!servidor || servidor.tipo !== 'influx') {
    r = { estado: 'error', resultado: 'El servidor InfluxDB de esta solicitud ya no existe. Cargalo de nuevo y reintentá.' };
  } else {
    try {
      r = await ejecutarBorrado(servidor, sol);
    } catch (e) {
      if (!(e instanceof InfluxError)) console.error('[laboratorio] borrado', sol.id, e);
      r = {
        estado: 'error',
        resultado: e instanceof InfluxError ? e.message : 'Falló la ejecución por un error inesperado. Avisá al equipo de desarrollo.',
      };
    }
  }
  return prisma.labBorrado.update({ where: { id: sol.id }, data: { ...r, ejecutadoAt: new Date() } });
}

// buckets: acepta lista de strings o texto multilínea; devuelve lista limpia.
const normalizarBuckets = (v) => {
  const arr = Array.isArray(v) ? v : String(v || '').split(/\r?\n|,/);
  const out = [...new Set(arr.map((b) => String(b || '').trim()).filter(Boolean))];
  return out.length ? out.slice(0, 50) : null;
};
const fechaValida = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

// ---- Servidores -----------------------------------------------------------
// La contraseña de los MQTT viaja (decisión de Leonardo 28/08: herramienta de
// administración interna con 👁). El TOKEN de los Influx no (pedido de Agustín
// 10/09): se escribe una vez, se usa solo desde el back y la API solo dice si
// está cargado (`tieneToken`).
const publico = (s) => (s.tipo === 'influx'
  ? { ...s, contrasena: undefined, tieneToken: Boolean(s.contrasena) }
  : s);

router.get('/servidores', async (req, res, next) => {
  try {
    const servidores = await prisma.labServidor.findMany({ orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
    res.json({ servidores: servidores.map(publico) });
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
    res.status(201).json(publico(s));
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
    res.json(publico(await prisma.labServidor.update({ where: { id: s.id }, data })));
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

// Crea la solicitud y la EJECUTA en el momento. Responde la fila ya con su
// resultado (ejecutado | sin_datos | error) para que la pantalla lo muestre.
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
    // El servidor MQTT es opcional (10/09, como en la pantalla vieja de la OV):
    // el borrado no lo usa, solo queda como referencia en el historial.
    if (b.servidorMqttId && !mqtt) throw new ApiError(400, 'bad_request', 'El servidor MQTT elegido ya no existe');
    if (!influx || influx.tipo !== 'influx') throw new ApiError(400, 'bad_request', 'Elegí el bucket de un servidor InfluxDB');
    const creado = await prisma.labBorrado.create({
      data: {
        servidorMqttId: mqtt?.id ?? null, servidorNombre: mqtt?.nombre ?? null,
        servidorInfluxId: influx.id, servidorInfluxNombre: influx.nombre,
        bucket, topico, desde, hasta,
        solicitadoPorId: req.colaborador?.id ?? null,
        solicitadoPor: req.colaborador?.nombre ?? null,
      },
    });
    res.status(201).json(await ejecutarSolicitud(creado));
  } catch (e) { next(e); }
});

// Reintenta una solicitud 'pendiente' (encolada antes del 10/09) o con 'error'.
router.post('/borrados/:id/ejecutar', async (req, res, next) => {
  try {
    const sol = await prisma.labBorrado.findUnique({ where: { id: Number(req.params.id) } });
    if (!sol) throw new ApiError(404, 'not_found', 'Solicitud no encontrada');
    if (!['pendiente', 'error'].includes(sol.estado)) {
      throw new ApiError(400, 'bad_request', 'Solo se puede ejecutar una solicitud pendiente o con error');
    }
    res.json(await ejecutarSolicitud(sol));
  } catch (e) { next(e); }
});

// Para marcar a mano el resultado de una solicitud si hace falta (p.ej. un
// borrado hecho por fuera). Sella ejecutadoAt al pasar a ejecutado/error.
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

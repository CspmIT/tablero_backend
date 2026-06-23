// Errores con forma uniforme: { error: { code, message } }
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Ruta no encontrada' } });
}

export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // Errores conocidos de Prisma
  if (err && err.code === 'P2025') {
    return res.status(404).json({ error: { code: 'not_found', message: 'Registro no encontrado' } });
  }
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: { code: 'conflict', message: 'Ya existe un registro con ese valor único' } });
  }
  console.error('[error]', err);
  res.status(500).json({ error: { code: 'internal', message: 'Error interno del servidor' } });
}

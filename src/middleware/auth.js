import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { ApiError } from './errorHandler.js';

// Lee el token, lo valida segun el modo, y deja en req.identity los claims.
// Modo "dev": decodifica sin verificar firma; si no hay token, usa un colaborador por defecto.
// Modo "prod": verifica la firma con AUTH_JWT_SECRET (se ajustara a las specs reales del identity).
function leerClaims(req) {
  const mode = process.env.AUTH_MODE || 'dev';
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (mode === 'prod') {
    if (!token) throw new ApiError(401, 'unauthorized', 'Falta el token de autenticación');
    try {
      return jwt.verify(token, process.env.AUTH_JWT_SECRET);
    } catch {
      throw new ApiError(401, 'unauthorized', 'Token inválido o expirado');
    }
  }

  // modo dev
  if (token) {
    const decoded = jwt.decode(token);
    if (decoded) return decoded;
  }
  // Sin token en dev: usuario por defecto para poder trabajar local.
  return { sub: 'dev', __devDefault: true };
}

// Adjunta req.identity (claims) y req.colaborador (mapeo en la base por identitySub).
export async function authenticate(req, res, next) {
  try {
    const claims = leerClaims(req);
    req.identity = claims;

    let colaborador = null;
    if (claims.__devDefault) {
      const id = Number(process.env.AUTH_DEV_DEFAULT_COLABORADOR_ID || 1);
      colaborador = await prisma.colaborador.findUnique({ where: { id } });
      // Si el id configurado no existe (p.ej. tras blanquear y reimportar, el
      // autoincrement de MySQL no vuelve a 1), caemos al manager o, en su
      // defecto, al colaborador de menor id, para no quedar sin usuario en dev.
      if (!colaborador) {
        colaborador = await prisma.colaborador.findFirst({ where: { tipo: 'manager' }, orderBy: { id: 'asc' } })
          || await prisma.colaborador.findFirst({ orderBy: { id: 'asc' } });
      }
    } else if (claims.sub) {
      colaborador = await prisma.colaborador.findUnique({ where: { identitySub: String(claims.sub) } });
    }
    req.colaborador = colaborador;
    next();
  } catch (e) {
    next(e);
  }
}

// Exige que el usuario esté aprovisionado (mapeado a un colaborador). Si no, 403.
export function requireProvisioned(req, res, next) {
  if (!req.colaborador) {
    return next(new ApiError(403, 'not_provisioned', 'Usuario no habilitado en el tablero'));
  }
  next();
}

// Exige uno de los tipos indicados (p.ej. 'manager', 'gerencial').
export function requireTipo(...tipos) {
  return (req, res, next) => {
    if (!req.colaborador || !tipos.includes(req.colaborador.tipo)) {
      return next(new ApiError(403, 'forbidden', 'No tenés permisos para esta acción'));
    }
    next();
  };
}

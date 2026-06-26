import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { signLoginToken } from '../lib/jwt.js';

// ---------------------------------------------------------------------------
//  Router PÚBLICO (sin authenticate). Se monta en app.js antes del middleware
//  de auth. Equivalente a /loginCooptech de Reconecta, adaptado a este backend
//  single-tenant: la credencial (tokenApp) se valida acá y se emite el JWT final.
// ---------------------------------------------------------------------------
export const publicAuthRouter = Router();

// POST /api/v1/auth/loginCooptech  { email, tokenApp } -> { token }
// 1. Busca el colaborador por email.
// 2. Valida que esté activo.
// 3. Valida que el tokenApp coincida.
// 4. "Mapea" el usuario en el primer login (fija identitySub si estaba en null).
// 5. Devuelve el JWT (exp 8h).
publicAuthRouter.post('/loginCooptech', async (req, res, next) => {
  try {
    const { email, tokenApp } = req.body || {};
    if (!email || !tokenApp) {
      throw new ApiError(400, 'bad_request', 'Faltan email o tokenApp');
    }

    // tokenApp está omitido globalmente; lo traemos explícito solo acá.
    const colaborador = await prisma.colaborador.findFirst({
      where: { email },
      omit: { tokenApp: false },
    });

    // Respuesta genérica para no revelar si el email existe.
    const credencialInvalida = !colaborador
      || !colaborador.activo
      || !colaborador.tokenApp
      || colaborador.tokenApp !== tokenApp;
    if (credencialInvalida) {
      throw new ApiError(401, 'unauthorized', 'Credenciales inválidas');
    }

    // Primer login: si no estaba mapeado al servicio de identidad, fijamos un
    // identitySub estable (su propio id) para que authenticate() pueda resolverlo.
    let identitySub = colaborador.identitySub;
    if (!identitySub) {
      identitySub = String(colaborador.id);
      await prisma.colaborador.update({
        where: { id: colaborador.id },
        data: { identitySub },
      });
    }

    const token = signLoginToken(colaborador, { identitySub });
    res.json({ token });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
//  Router PROTEGIDO (detrás de authenticate, montado en /api/v1/auth).
// ---------------------------------------------------------------------------
const router = Router();

// Usuario actual, mapeado desde el token de identidad al colaborador del tablero.
router.get('/me', (req, res) => {
  const c = req.colaborador;
  res.json({
    colaboradorId: c ? c.id : null,
    identitySub: req.identity?.sub ?? null,
    nombre: c ? c.nombre : (req.identity?.name ?? null),
    email: c ? c.email : (req.identity?.email ?? null),
    tipo: c ? c.tipo : null,
    imgProfile: req.identity?.img_profile ?? null,
    aprovisionado: !!c,
  });
});

export default router;

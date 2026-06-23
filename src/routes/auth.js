import { Router } from 'express';
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

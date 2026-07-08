import jwt from 'jsonwebtoken';

// Emisión del JWT final de la app (equivalente a AuthService.signTokenCooptech de
// Reconecta, adaptado a este backend single-tenant: sin `schemaName`).
//
// El claim `sub` debe coincidir con `identitySub` porque es lo que usa el
// middleware `authenticate` para mapear el token a un Colaborador.
// Expiración: 30 días (app de escritorio interna; evita re-login diario).

const EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60; // 30 días

function getSecret() {
  // En prod debe estar AUTH_JWT_SECRET (el middleware lo usa para verificar).
  // En dev el middleware decodifica sin verificar, así que un fallback alcanza.
  return process.env.AUTH_JWT_SECRET || 'dev-insecure-secret';
}

// Firma un JWT a partir de un colaborador ya validado.
export function signLoginToken(colaborador, { identitySub } = {}) {
  const sub = identitySub ?? colaborador.identitySub;
  const payload = {
    iss: 'tablero',                 // identifica al emisor (single-tenant)
    sub: String(sub),               // lo usa authenticate() para mapear el usuario
    name: colaborador.nombre,
    email: colaborador.email ?? null,
    profile: colaborador.tipo,      // tipo del tablero (manager, gerencial, ...)
    img_profile: colaborador.foto ?? null,
  };
  return jwt.sign(payload, getSecret(), { expiresIn: EXPIRES_IN_SECONDS });
}

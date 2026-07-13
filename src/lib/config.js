// Configuración editable desde la app, cifrada en reposo.
// AES-256-GCM con clave derivada de AUTH_JWT_SECRET: un dump de la base no
// expone secretos. Si AUTH_JWT_SECRET cambia, los valores guardados dejan de
// poder descifrarse y se tratan como "no configurado" (recargar desde la UI).
import crypto from 'crypto';
import { prisma } from './prisma.js';

const claveCifrado = () => crypto.createHash('sha256')
  .update(String(process.env.AUTH_JWT_SECRET || 'dev-secret') + '::config')
  .digest();

export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const data = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function descifrar(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', claveCifrado(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// Caché en memoria (el asistente consulta la clave en cada pregunta).
const cache = new Map(); // clave -> { valor, ts }
const TTL_MS = 60_000;

export async function getConfig(clave) {
  const c = cache.get(clave);
  if (c && Date.now() - c.ts < TTL_MS) return c.valor;
  let valor = null;
  try {
    const row = await prisma.configuracion.findUnique({ where: { clave } });
    if (row?.valor) valor = descifrar(row.valor);
  } catch { valor = null; /* tabla ausente o secreto cambiado */ }
  cache.set(clave, { valor, ts: Date.now() });
  return valor;
}

export async function setConfig(clave, valor) {
  if (valor == null || valor === '') {
    await prisma.configuracion.deleteMany({ where: { clave } });
  } else {
    const cifrado = cifrar(valor);
    await prisma.configuracion.upsert({
      where: { clave },
      update: { valor: cifrado },
      create: { clave, valor: cifrado },
    });
  }
  cache.delete(clave);
}

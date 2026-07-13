// Cliente mínimo de la API de Anthropic (Claude) usando fetch nativo de Node 20.
// Resolución de la clave (en orden): Configuracion en base (editable desde la
// app, cifrada) → variable de entorno ANTHROPIC_API_KEY (respaldo).
//   ASISTENTE_MODEL   opcional; por defecto claude-sonnet-4-6
import { ApiError } from '../middleware/errorHandler.js';
import { getConfig } from './config.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
export const CONFIG_CLAVE_API = 'anthropic_api_key';

export async function resolverApiKey() {
  return (await getConfig(CONFIG_CLAVE_API)) || process.env.ANTHROPIC_API_KEY || null;
}

// Estado para la UI: configurado + origen (db/env) + máscara (nunca la clave entera).
export async function asistenteEstado() {
  const db = await getConfig(CONFIG_CLAVE_API);
  const clave = db || process.env.ANTHROPIC_API_KEY || null;
  if (!clave) return { configurado: false, origen: null, mascara: null };
  return { configurado: true, origen: db ? 'db' : 'env', mascara: mascarar(clave) };
}

export const mascarar = (k) => `${String(k).slice(0, 12)}…${String(k).slice(-4)}`;

// Una llamada al endpoint /v1/messages. `apiKey` opcional (para probar una clave
// antes de guardarla); si no se pasa, se resuelve la configurada.
export async function llamarClaude({ system, messages, tools, maxTokens = 1500, apiKey }) {
  const clave = apiKey || await resolverApiKey();
  if (!clave) {
    throw new ApiError(503, 'asistente_no_configurado',
      'El asistente no está configurado (cargá la clave desde la solapa Asistente IA o en ANTHROPIC_API_KEY)');
  }
  const body = {
    model: process.env.ASISTENTE_MODEL || 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages,
  };
  if (tools?.length) body.tools = tools;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': clave,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) throw new ApiError(401, 'clave_invalida', 'La clave de API fue rechazada por Anthropic');
    throw new ApiError(res.status === 429 || res.status === 529 ? 503 : 502,
      'asistente_error', `Error del servicio de IA: ${msg}`);
  }
  return data;
}

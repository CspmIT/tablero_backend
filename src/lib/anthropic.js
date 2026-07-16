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
// `stream: true` → pide la respuesta por SSE y la ACUMULA acá mismo, devolviendo
// la misma forma que la llamada normal. Imprescindible para generaciones largas
// (CriterIA, 1-3 min): sin streaming, ninguna capa intermedia ve bytes hasta el
// final y la conexión muere ~100 s (el clásico 524 del borde). Con streaming,
// la respuesta gotea desde el primer segundo y nadie corta.
export async function llamarClaude({ system, messages, tools, maxTokens = 1500, apiKey, stream = false }) {
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
  if (stream) body.stream = true;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': clave,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* cuerpo no-JSON (proxy/borde) */ }
    const msg = data?.error?.message || `HTTP ${res.status} ${res.statusText || ''}`.trim();
    if (res.status === 401) throw new ApiError(401, 'clave_invalida', 'La clave de API fue rechazada por Anthropic');
    throw new ApiError(res.status === 429 || res.status === 529 ? 503 : 502,
      'asistente_error', `Error del servicio de IA: ${msg}`);
  }

  if (!stream) {
    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    return data;
  }

  // Acumulación del SSE: misma forma de salida que la llamada normal.
  const decoder = new TextDecoder();
  let buffer = '', texto = '', model = null;
  const usage = {};
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let corte;
    while ((corte = buffer.indexOf('\n')) >= 0) {
      const linea = buffer.slice(0, corte).trim();
      buffer = buffer.slice(corte + 1);
      if (!linea.startsWith('data:')) continue;
      let ev = null;
      try { ev = JSON.parse(linea.slice(5).trim()); } catch { continue; }
      if (ev.type === 'message_start') {
        model = ev.message?.model || null;
        if (ev.message?.usage?.input_tokens != null) usage.input_tokens = ev.message.usage.input_tokens;
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        texto += ev.delta.text;
      } else if (ev.type === 'message_delta') {
        if (ev.usage?.output_tokens != null) usage.output_tokens = ev.usage.output_tokens;
      } else if (ev.type === 'error') {
        throw new ApiError(502, 'asistente_error', `Error del servicio de IA: ${ev.error?.message || 'error en el stream'}`);
      }
    }
  }
  return { content: [{ type: 'text', text: texto }], usage, model };
}

// CriterIA — endpoints productivos del motor (caso C / Copa IA).
// El iframe agua.html NUNCA llama a Claude: manda todo por postMessage al
// tablero, el tablero llama acá, y este backend es el único frente a la API.
// Las imágenes llegan como data-URI ya reescaladas por el wizard (canvas del
// cliente, ~1100 px): sin dependencias nuevas de imagen en el servidor.
import { Router } from 'express';
import { llamarClaude } from '../lib/anthropic.js';
import { SYSTEM_GENERAR, SYSTEM_PREGUNTAS } from '../lib/criteriaPrompt.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

// La generación con imágenes tarda 1-3 minutos: extender los timeouts del
// request/response para que Node no corte antes que Claude responda.
// (El proxy inverso TAMBIÉN debe permitirlo: proxy_read_timeout >= 300s.)
router.use((req, res, next) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  next();
});

const MAX_IMAGENES = 20;
const MAX_DATAURI = 2_500_000; // ~1.8 MB reales por imagen, de sobra para 1100 px

function bloquesImagen(imagenes) {
  const lista = Array.isArray(imagenes) ? imagenes.slice(0, MAX_IMAGENES) : [];
  const bloques = [];
  for (const img of lista) {
    const dataUri = typeof img === 'string' ? img : img?.data;
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(String(dataUri || ''));
    if (!m) continue;
    if (m[2].length > MAX_DATAURI) throw new ApiError(413, 'imagen_grande', 'Una imagen supera el tamaño máximo; el wizard debe reescalarla');
    bloques.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    const epigrafe = typeof img === 'object' && img?.caption ? String(img.caption) : null;
    const boceto = typeof img === 'object' && img?.is_sketch;
    if (epigrafe || boceto) bloques.push({ type: 'text', text: `(${boceto ? 'BOCETO a mano' : 'foto'}${epigrafe ? ` — epígrafe: ${epigrafe}` : ''})` });
  }
  return bloques;
}

function armarContenido({ relevamiento, imagenes, epigrafesNoEnviadas, respuestas }) {
  if (!relevamiento || typeof relevamiento !== 'object') {
    throw new ApiError(400, 'bad_request', 'Falta el relevamiento');
  }
  const contenido = [
    { type: 'text', text: 'RELEVAMIENTO DE CAMPO (datos estructurados):\n' + JSON.stringify(relevamiento) },
  ];
  // Los epígrafes de TODAS las fotos viajan como texto, aunque la imagen no se
  // procese por visión (decisión de diseño: el texto ya dice lo que importa).
  if (Array.isArray(epigrafesNoEnviadas) && epigrafesNoEnviadas.length) {
    contenido.push({ type: 'text', text: 'EPÍGRAFES DE FOTOS NO ADJUNTADAS (referencia):\n- ' + epigrafesNoEnviadas.map(String).join('\n- ') });
  }
  const imgs = bloquesImagen(imagenes);
  if (imgs.length) {
    contenido.push({ type: 'text', text: `FOTOS Y BOCETOS DEL RELEVAMIENTO (${imgs.filter(b => b.type === 'image').length} imágenes):` });
    contenido.push(...imgs);
  }
  if (Array.isArray(respuestas) && respuestas.length) {
    contenido.push({
      type: 'text',
      text: 'RESPUESTAS ACLARATORIAS DEL TÉCNICO EN CAMPO:\n' + respuestas
        .filter(r => r && (r.respuesta || '').trim())
        .map(r => `P: ${r.pregunta}\nR: ${r.respuesta}`).join('\n\n'),
    });
  }
  return contenido;
}

function parsearJson(data, etiqueta) {
  const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return JSON.parse(texto.replace(/^```json?\s*|```\s*$/g, '').trim());
  } catch {
    throw new ApiError(502, 'criteria_salida', `CriterIA no devolvió ${etiqueta} válido; reintentá la generación`);
  }
}

// POST /criteria/preguntas { relevamiento, imagenes?, epigrafesNoEnviadas? }
// → { preguntas: [≤5], tokens }
// SSE de punta a punta (30/07): el bug de producción era que el streaming
// existía solo entre Anthropic y este backend — hacia el navegador la
// respuesta era un res.json() al FINAL, y los proxies intermedios (timeout
// típico: 60s) mataban la conexión muda → HTTP 504: la generación jamás
// llegó a destino. Ahora la respuesta ES un event-stream: cabeceras al
// instante, latido cada 10s mientras Claude trabaja, y el resultado como
// evento final. X-Accel-Buffering:no desactiva el buffering de nginx.
function iniciarSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': hola\n\n');
  const latido = setInterval(() => { try { res.write(': latido\n\n'); } catch {} }, 10000);
  return {
    resultado(obj) { res.write(`event: resultado\ndata: ${JSON.stringify(obj)}\n\n`); },
    error(e) {
      const cuerpo = { error: e?.code || 'error', mensaje: e?.message || 'Falló la generación' };
      res.write(`event: error\ndata: ${JSON.stringify(cuerpo)}\n\n`);
    },
    cerrar() { clearInterval(latido); try { res.end(); } catch {} },
  };
}

router.post('/preguntas', async (req, res) => {
  const sse = iniciarSSE(res);
  try {
    const contenido = armarContenido(req.body || {});
    contenido.push({ type: 'text', text: 'Devolvé SOLO el JSON de preguntas.' });
    const data = await llamarClaude({
      system: SYSTEM_PREGUNTAS,
      messages: [{ role: 'user', content: contenido }],
      maxTokens: 2000,
      stream: true, // generaciones largas: sin stream, el borde corta ~100 s
    });
    const out = parsearJson(data, 'las preguntas');
    sse.resultado({
      preguntas: (out.preguntas || []).slice(0, 5),
      tokens: { entrada: data.usage?.input_tokens, salida: data.usage?.output_tokens },
    });
  } catch (e) { sse.error(e); }
  finally { sse.cerrar(); }
});

// POST /criteria/generar { relevamiento, imagenes?, epigrafesNoEnviadas?, respuestas? }
// → { planteo, tokens, modelo }
router.post('/generar', async (req, res) => {
  const sse = iniciarSSE(res);
  try {
    const contenido = armarContenido(req.body || {});
    contenido.push({ type: 'text', text: 'Componé el planteo aplicando el criterio. Respondé SOLO el JSON.' });
    const data = await llamarClaude({
      system: SYSTEM_GENERAR,
      messages: [{ role: 'user', content: contenido }],
      maxTokens: 16000,
      stream: true, // imprescindible: la generación tarda 1-3 min
    });
    const planteo = parsearJson(data, 'un planteo');
    sse.resultado({
      planteo,
      modelo: data.model,
      tokens: { entrada: data.usage?.input_tokens, salida: data.usage?.output_tokens },
    });
  } catch (e) { sse.error(e); }
  finally { sse.cerrar(); }
});

export default router;

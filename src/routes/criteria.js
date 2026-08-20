// CriterIA — endpoints productivos del motor (caso C / Copa IA).
// El iframe agua.html NUNCA llama a Claude: manda todo por postMessage al
// tablero, el tablero llama acá, y este backend es el único frente a la API.
// Las imágenes llegan como data-URI ya reescaladas por el wizard (canvas del
// cliente, ~1100 px): sin dependencias nuevas de imagen en el servidor.
import { Router } from 'express';
import { llamarClaude } from '../lib/anthropic.js';
import { SYSTEM_GENERAR, SYSTEM_PREGUNTAS, SYSTEM_NOTA, SYSTEM_CORREGIR } from '../lib/criteriaPrompt.js';
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

// Resumen DURO computado en el servidor (20/08): hechos contables que el
// modelo no puede pasar por alto aunque el JSON sea largo. Bug de origen:
// una sala con pumps[3] se planteó como UNA bomba. Determinístico > prompt.
function resumenDuro(relevamiento) {
  try {
    const L = [];
    for (const z of relevamiento?.zonas || []) {
      for (const c of z?.componentes || []) {
        const d = c?.data || {};
        if (c.type === 'sala_bombeo') {
          const pumps = Array.isArray(d.pumps) ? d.pumps : [];
          L.push(`- ${z.nombre || 'Zona'} · ${d.id_local || 'sala de bombeo'}: ${pumps.length} BOMBA(S) [${pumps.map(b => `${b.rotulo || 'bomba'} ${b.tension || ''}`.trim()).join(' | ')}]${d.observaciones ? ` — obs: ${d.observaciones}` : ''}`);
        }
        if (c.type === 'caudalimetro') {
          L.push(`- ${z.nombre || 'Zona'} · ${d.id_local || 'caudalímetro'}: EXISTENTE, tipo ${d.tipo_medicion || '?'}, marca ${d.marca_modelo || '?'}, salida disponible ${d.salida_disponible || '?'}${d.estado ? `, estado ${d.estado}` : ''}`);
        }
        if (c.type === 'cisterna') {
          L.push(`- ${z.nombre || 'Zona'} · ${d.id_local || 'cisterna'}${d.doble_cuerpo ? ' (doble cuerpo)' : ''}${d.altura_util_m ? `, altura útil ${d.altura_util_m} m` : ''}`);
        }
        if (c.type === 'cloracion') {
          L.push(`- ${z.nombre || 'Zona'} · ${d.id_local || 'cloración'}: tipo ${d.tipo || '?'}${d.observaciones ? ` — obs: ${d.observaciones}` : ''}`);
        }
      }
    }
    // Totales explícitos (20/08 bis): además del detalle, el conteo por tipo
    // en una línea — "Cisternas" en plural con UN componente = UNA cisterna.
    const zonas = relevamiento?.zonas || [];
    const cuenta = (tipo) => zonas.reduce((a, z) => a + (z?.componentes || []).filter((c) => c?.type === tipo).length, 0);
    const bombas = zonas.reduce((a, z) => a + (z?.componentes || []).reduce((b, c) => b + (c?.type === 'sala_bombeo' && Array.isArray(c?.data?.pumps) ? c.data.pumps.length : 0), 0), 0);
    L.push(`TOTALES POR TIPO (unidades = componentes cargados; nombres en plural NO suman unidades): cisternas: ${cuenta('cisterna')} · salas de bombeo: ${cuenta('sala_bombeo')} (bombas: ${bombas}) · caudalímetros: ${cuenta('caudalimetro')} · cloración: ${cuenta('cloracion')} · tableros: ${cuenta('tablero')}`);
    return L.length ? 'HECHOS DUROS DEL RELEVAMIENTO (conteos verificados por el sistema — el planteo DEBE ser coherente con esto):\n' + L.join('\n') : null;
  } catch { return null; }
}

function armarContenido({ relevamiento, imagenes, epigrafesNoEnviadas, respuestas }) {
  if (!relevamiento || typeof relevamiento !== 'object') {
    throw new ApiError(400, 'bad_request', 'Falta el relevamiento');
  }
  const contenido = [
    { type: 'text', text: 'RELEVAMIENTO DE CAMPO (datos estructurados):\n' + JSON.stringify(relevamiento) },
  ];
  const duro = resumenDuro(relevamiento);
  if (duro) contenido.push({ type: 'text', text: duro });
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

// POST /criteria/corregir { relevamiento, planteo, ajustes, feedback? }
// Corrección dirigida (20/08): los ajustes del validador CORRIGEN el planteo
// (recalculan equipamiento/asignación), no quedan como comentarios.
router.post('/corregir', async (req, res) => {
  const sse = iniciarSSE(res);
  try {
    const { relevamiento, planteo, ajustes, feedback } = req.body || {};
    if (!planteo || typeof planteo !== 'object') throw new ApiError(400, 'bad_request', 'Falta el planteo a corregir');
    if (!String(ajustes || '').trim() && !feedback) throw new ApiError(400, 'bad_request', 'No hay ajustes para aplicar');
    const contenido = [
      { type: 'text', text: 'RELEVAMIENTO DE CAMPO (datos estructurados):\n' + JSON.stringify(relevamiento || {}) },
    ];
    const duro = resumenDuro(relevamiento || {});
    if (duro) contenido.push({ type: 'text', text: duro });
    contenido.push({ type: 'text', text: 'PLANTEO ACTUAL (a corregir):\n' + JSON.stringify(planteo) });
    if (String(ajustes || '').trim()) contenido.push({ type: 'text', text: 'AJUSTES DEL INGENIERO VALIDADOR (órdenes de corrección):\n' + String(ajustes).slice(0, 8000) });
    if (feedback && typeof feedback === 'object' && Object.keys(feedback).length) {
      contenido.push({ type: 'text', text: 'REACCIONES DE LA REUNIÓN CON EL CLIENTE (por sección: sigue/ahora_no + notas):\n' + JSON.stringify(feedback) });
    }
    contenido.push({ type: 'text', text: 'Aplicá las correcciones y devolvé el planteo COMPLETO corregido. SOLO el JSON.' });
    const data = await llamarClaude({
      system: SYSTEM_CORREGIR,
      messages: [{ role: 'user', content: contenido }],
      maxTokens: 16000,
      stream: true,
    });
    const corregido = parsearJson(data, 'un planteo corregido');
    sse.resultado({
      planteo: corregido,
      modelo: data.model,
      tokens: { entrada: data.usage?.input_tokens, salida: data.usage?.output_tokens },
    });
  } catch (e) { sse.error(e); }
  finally { sse.cerrar(); }
});

// POST /criteria/nota { relevamiento, planteoResumen?, destinatario, motivo }
// Redacta UNA nota a terceros bajo demanda (el planteo solo las sugiere).
router.post('/nota', async (req, res) => {
  const sse = iniciarSSE(res);
  try {
    const { relevamiento, planteoResumen, destinatario, motivo } = req.body || {};
    if (!destinatario) throw new ApiError(400, 'bad_request', 'Falta el destinatario de la nota');
    const contenido = [
      { type: 'text', text: 'CONTEXTO DEL RELEVAMIENTO:\n' + JSON.stringify(relevamiento || {}) },
      ...(planteoResumen ? [{ type: 'text', text: 'RESUMEN DEL PLANTEO:\n' + String(planteoResumen).slice(0, 4000) }] : []),
      { type: 'text', text: `DESTINATARIO: ${JSON.stringify(destinatario)}\nMOTIVO: ${String(motivo || '')}\nRedactá la nota. Respondé SOLO el JSON.` },
    ];
    const data = await llamarClaude({
      system: SYSTEM_NOTA,
      messages: [{ role: 'user', content: contenido }],
      maxTokens: 3000,
      stream: true,
    });
    const nota = parsearJson(data, 'la nota');
    sse.resultado({ nota, tokens: { entrada: data.usage?.input_tokens, salida: data.usage?.output_tokens } });
  } catch (e) { sse.error(e); }
  finally { sse.cerrar(); }
});

export default router;

// Solapa "Asistente IA": chat con Claude sobre los datos del tablero.
// Arquitectura: frontend → este endpoint → Claude decide qué herramientas usar →
// el backend las ejecuta contra Prisma (filtradas por rol) → respuesta final.
// Claude NUNCA accede a la base: solo ve lo que las herramientas devuelven.
import { Router } from 'express';
import { llamarClaude, asistenteEstado, mascarar, CONFIG_CLAVE_API } from '../lib/anthropic.js';
import { setConfig } from '../lib/config.js';
import { toolsParaTipo, ejecutarTool } from '../lib/asistenteTools.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireTipo } from '../middleware/auth.js';

const router = Router();
const MAX_RONDAS = 8;      // tope de idas y vueltas de herramientas por pregunta
const MAX_MENSAJES = 20;   // tope de historial que aceptamos del cliente

// Metodología de priorización de Cooptech (aprobada 07/07/2026). Este texto ES
// la formalización del criterio: si cambia el método, se cambia acá.
const METODOLOGIA_PRIORIZACION = `
Cuando te pidan sugerir la próxima tarea a tomar, aplicá ESTRICTAMENTE y en este
orden la metodología de priorización de Cooptech, y explicá el porqué de la sugerencia:
1. TERMINAR LO EMPEZADO (límite de trabajo en curso): si la persona tiene tareas en
   "doing", la prioridad es cerrarlas antes de tomar algo nuevo. Sugerí retomar la
   más avanzada o la más próxima a vencer, y decilo explícitamente.
2. PRIORIDAD de la tarjeta (urgente > alta > media > baja), mirando "todo" primero
   y "backlog" después.
3. VENCIMIENTO: ante igual prioridad, la de fecha límite más próxima.
4. APORTE A OBJETIVOS: ante empate, la que pertenezca a un proyecto vinculado a un
   objetivo de mayor peso.
La respuesta debe ser reproducible: mismo estado de datos → misma sugerencia,
sin importar quién pregunta.`;

function systemPrompt(colaborador) {
  const hoy = new Date().toISOString().slice(0, 10);
  return `Sos el asistente del Tablero de Mando de Cooptech (unidad de IT y desarrollo
de la cooperativa Coopmorteros, Argentina). Respondés en español argentino, claro y
al grano, sobre los datos reales del tablero: grilla de actividad, kanban, CRM,
objetivos, horas extra y costos.

Fecha de hoy: ${hoy}.
Quien pregunta: ${colaborador.nombre} (perfil: ${colaborador.tipo}).

Reglas:
- Usá las herramientas para responder con datos reales; no inventes números.
- Si una consulta usa la estimación de horas por etiqueta, aclarás siempre el criterio
  (8 hs por día trabajado repartidas entre los ítems del día).
- Si no tenés permiso o datos para algo, decilo sin vueltas.
- Cifras con separadores legibles y unidades (hs, USD, ARS).
- Sé conciso: primero la respuesta, después el detalle si aporta.
${METODOLOGIA_PRIORIZACION}`;
}

// GET /asistente/estado → configurado + origen (db/env) + máscara. Nunca la clave.
router.get('/estado', async (req, res, next) => {
  try { res.json(await asistenteEstado()); } catch (e) { next(e); }
});

// PUT /asistente/clave { apiKey } — solo manager. Valida la clave con una
// llamada mínima real ANTES de guardarla (cifrada) en Configuracion.
router.put('/clave', requireTipo('manager'), async (req, res, next) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
      throw new ApiError(400, 'bad_request', 'El formato no parece una clave de Anthropic (sk-ant-…)');
    }
    // Prueba en vivo: si la clave es inválida, Anthropic devuelve 401 y NO se guarda.
    await llamarClaude({ apiKey, maxTokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    await setConfig(CONFIG_CLAVE_API, apiKey);
    res.json({ ok: true, mascara: mascarar(apiKey) });
  } catch (e) { next(e); }
});

// DELETE /asistente/clave — solo manager. Quita la clave de la base (si existe
// ANTHROPIC_API_KEY como variable de entorno, queda esa como respaldo).
router.delete('/clave', requireTipo('manager'), async (req, res, next) => {
  try {
    await setConfig(CONFIG_CLAVE_API, null);
    res.json(await asistenteEstado());
  } catch (e) { next(e); }
});

// POST /asistente/chat  { messages: [{ role: 'user'|'assistant', content: string }] }
// Devuelve { respuesta, herramientas: [nombres usados] }.
router.post('/chat', async (req, res, next) => {
  try {
    const entrada = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!entrada?.length) throw new ApiError(400, 'bad_request', 'Faltan mensajes');
    // Solo aceptamos texto plano del cliente (roles user/assistant alternados).
    const messages = entrada.slice(-MAX_MENSAJES).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 4000),
    }));

    const tipo = req.colaborador.tipo;
    const tools = toolsParaTipo(tipo).map(t => t.def);
    const system = systemPrompt(req.colaborador);
    const herramientasUsadas = [];

    let respuesta = null;
    for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
      const data = await llamarClaude({ system, messages, tools });
      const contenido = data.content || [];
      const usos = contenido.filter(b => b.type === 'tool_use');

      if (data.stop_reason !== 'tool_use' || !usos.length) {
        respuesta = contenido.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        break;
      }

      // Ejecutamos cada herramienta pedida y devolvemos los resultados.
      messages.push({ role: 'assistant', content: contenido });
      const resultados = [];
      for (const uso of usos) {
        herramientasUsadas.push(uso.name);
        const salida = await ejecutarTool(uso.name, uso.input, tipo);
        resultados.push({
          type: 'tool_result',
          tool_use_id: uso.id,
          content: JSON.stringify(salida),
        });
      }
      messages.push({ role: 'user', content: resultados });
    }

    if (respuesta == null) {
      respuesta = 'No pude cerrar la respuesta en el límite de consultas. Probá con una pregunta más acotada.';
    }
    res.json({ respuesta, herramientas: [...new Set(herramientasUsadas)] });
  } catch (e) { next(e); }
});

export default router;

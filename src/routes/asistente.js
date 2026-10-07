// Solapa "Asistente IA": chat con Claude sobre los datos del tablero.
// Arquitectura: frontend → este endpoint → Claude decide qué herramientas usar →
// el backend las ejecuta contra Prisma (filtradas por rol) → respuesta final.
// Claude NUNCA accede a la base: solo ve lo que las herramientas devuelven.
import { Router } from 'express';
import { llamarClaude, asistenteEstado, mascarar, CONFIG_CLAVE_API } from '../lib/anthropic.js';
import { getConfig, setConfig } from '../lib/config.js';
import { toolsParaTipo, ejecutarTool } from '../lib/asistenteTools.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireTipo } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

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
objetivos, horas extra, costos, tickets del Inbox y consultas comerciales
entradas por la landing web.

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

// ============================================================================
// Análisis IA de tickets recurrentes (07/10, pedido de Sofía — gerencia de
// administración). Los tickets son carga humana: el mismo problema aparece
// escrito distinto, por eso el agrupado es SEMÁNTICO (lo hace Claude), no por
// texto exacto. El informe propone soluciones de fondo a partir de los grupos
// y de cómo se resolvieron. Vive en Métricas OV; el último informe queda
// guardado en Configuracion (sin migración) para que verlo no cueste API.
// ============================================================================

const CLAVE_ANALISIS = 'tickets_analisis_ultimo';
const MAX_TICKETS_ANALISIS = 400; // tope de tickets que viajan a la IA por informe

// ---- Historial de informes (07/10 bis, pedido de Leonardo): panel lateral del
// Asistente con los informes archivados — los Análisis IA de tickets (cada
// generación queda, ya no se pisa) y respuestas del chat guardadas a mano.
// Sin migración: índice en Configuracion `asistente_informes_indice` (solo
// metadatos, liviano) + una clave `asistente_informe_<id>` por informe (el
// Text de MySQL son ~45KB útiles cifrados: por eso NO van todos juntos).
const CLAVE_INFORMES_INDICE = 'asistente_informes_indice';
const claveInforme = (id) => `asistente_informe_${id}`;
const MAX_INFORMES = 30; // poda: al guardar el 31º se borra el más viejo

async function leerIndiceInformes() {
  try {
    const crudo = await getConfig(CLAVE_INFORMES_INDICE);
    const lista = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista : [];
  } catch { return []; }
}

// Archiva un informe y devuelve su meta. `contenido` es el cuerpo completo
// (se guarda aparte); `meta` es lo que lista el panel (liviano, sin cuerpo).
async function archivarInforme(meta, contenido) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const indice = await leerIndiceInformes();
  indice.unshift({ ...meta, id });
  // Poda: fuera del índice Y de la base (la clave del contenido también).
  const podados = indice.splice(MAX_INFORMES);
  for (const p of podados) { try { await setConfig(claveInforme(p.id), null); } catch { /* ya no estaba */ } }
  let cuerpo = JSON.stringify(contenido);
  if (cuerpo.length > 45000) { // guard del Text cifrado; el panel avisa el recorte
    cuerpo = JSON.stringify({ ...contenido, recortado: true,
      respuesta: contenido.respuesta ? String(contenido.respuesta).slice(0, 38000) : undefined,
      informe: contenido.informe ? { ...contenido.informe, grupos: (contenido.informe.grupos || []).slice(0, 15) } : undefined });
  }
  await setConfig(claveInforme(id), cuerpo);
  await setConfig(CLAVE_INFORMES_INDICE, JSON.stringify(indice));
  return { ...meta, id };
}

// GET /asistente/informes → índice (más nuevo primero). Equipo interno.
router.get('/informes', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
  try { res.json({ informes: await leerIndiceInformes() }); } catch (e) { next(e); }
});

// POST /asistente/informes — guardar una respuesta del chat como informe.
router.post('/informes', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
  try {
    const pregunta = String(req.body?.pregunta || '').trim().slice(0, 1000);
    const respuesta = String(req.body?.respuesta || '').trim();
    if (!respuesta) throw new ApiError(400, 'bad_request', 'No hay respuesta para guardar');
    if (respuesta.length > 40000) throw new ApiError(400, 'bad_request', 'La respuesta es demasiado larga para archivar');
    const titulo = String(req.body?.titulo || '').trim().slice(0, 120)
      || (pregunta ? pregunta.slice(0, 80) : 'Consulta al asistente');
    const meta = {
      tipo: 'chat', titulo,
      generadoPor: req.colaborador?.nombre || null,
      generadoEl: new Date().toISOString(),
    };
    const guardado = await archivarInforme(meta, {
      pregunta, respuesta,
      herramientas: Array.isArray(req.body?.herramientas) ? req.body.herramientas.map(String).slice(0, 20) : [],
    });
    res.status(201).json({ informe: guardado });
  } catch (e) { next(e); }
});

// GET /asistente/informes/:id → meta + contenido completo. Equipo interno.
router.get('/informes/:id', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
  try {
    const indice = await leerIndiceInformes();
    const meta = indice.find(i => i.id === req.params.id);
    const crudo = meta ? await getConfig(claveInforme(meta.id)) : null;
    if (!meta || !crudo) throw new ApiError(404, 'not_found', 'Ese informe ya no existe');
    res.json({ informe: { ...meta, ...JSON.parse(crudo) } });
  } catch (e) { next(e); }
});

// DELETE /asistente/informes/:id — solo conducción (borra del archivo).
router.delete('/informes/:id', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const indice = await leerIndiceInformes();
    const queda = indice.filter(i => i.id !== req.params.id);
    if (queda.length === indice.length) throw new ApiError(404, 'not_found', 'Ese informe ya no existe');
    await setConfig(claveInforme(req.params.id), null);
    await setConfig(CLAVE_INFORMES_INDICE, JSON.stringify(queda));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

const fechaDe = (t) => t.ocurridoAt || t.createdAt;

// Tickets del período con la última novedad de su hilo (cómo terminó/avanzó).
async function ticketsDelPeriodo(desde, hasta) {
  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { ocurridoAt: { gte: desde, lte: hasta } },
        { ocurridoAt: null, createdAt: { gte: desde, lte: hasta } },
      ],
    },
    select: {
      id: true, titulo: true, descripcion: true, estado: true, origen: true,
      ovTipo: true, ovCausa: true, area: true, ocurridoAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const recorte = tickets.slice(0, MAX_TICKETS_ANALISIS);
  // Última novedad de cada hilo, en una sola consulta (sin N+1).
  const mensajes = recorte.length ? await prisma.ticketMensaje.findMany({
    where: { ticketId: { in: recorte.map(t => t.id) } },
    select: { ticketId: true, texto: true },
    orderBy: { id: 'asc' },
  }) : [];
  const ultimaNovedad = {};
  for (const m of mensajes) ultimaNovedad[m.ticketId] = m.texto; // queda la última
  return { total: tickets.length, recorte, ultimaNovedad };
}

const SYSTEM_ANALISIS = `Sos un analista de soporte técnico de Cooptech (IT y desarrollo
de la cooperativa Coopmorteros, Argentina). Vas a recibir tickets de la mesa de ayuda
interna. Son carga humana: EL MISMO PROBLEMA aparece escrito de maneras distintas
(sinónimos, abreviaturas, errores de tipeo). Tu tarea:
1. Agrupá los tickets que describen el MISMO problema de fondo, aunque estén redactados
   distinto (agrupado semántico). Solo grupos con 2 o más tickets.
2. Para cada grupo, mirá cómo se vinieron resolviendo (última novedad del hilo, estado)
   y proponé UNA solución de fondo que elimine la causa raíz: un fix de producto, una
   automatización, documentación/autogestión para el cliente, capacitación, etc.
3. Ordená los grupos de mayor a menor frecuencia.

Respondé SOLO con un JSON válido (sin markdown, sin texto afuera) con esta forma exacta:
{
  "resumen": "3 a 5 líneas: qué domina el período y qué conviene atacar primero",
  "grupos": [
    {
      "patron": "nombre corto del problema recurrente",
      "sintoma": "cómo lo describen los usuarios (1-2 líneas)",
      "frecuencia": <cantidad de tickets del grupo>,
      "ticketIds": [ids de los tickets del grupo],
      "solucionTipica": "cómo se viene resolviendo caso a caso (1-2 líneas)",
      "propuestaDeFondo": "qué hacer para que deje de ocurrir (2-4 líneas, concreta)",
      "impacto": "alto" | "medio" | "bajo"
    }
  ]
}
"impacto" pondera frecuencia × costo de cada ocurrencia. En español argentino. Si ningún
problema se repite, devolvé grupos: [] y decilo en el resumen.`;

// Línea compacta por ticket para el prompt (presupuesto de contexto acotado).
function lineaTicket(t, novedad) {
  const partes = [
    `#${t.id}`,
    fechaDe(t).toISOString().slice(0, 10),
    `[${t.estado}/${t.origen}${t.ovTipo ? '/' + t.ovTipo : ''}${t.ovCausa ? '/' + t.ovCausa : ''}]`,
    t.titulo,
    `— ${String(t.descripcion || '').replace(/\s+/g, ' ').slice(0, 280)}`,
  ];
  if (novedad) partes.push(`| última novedad: ${String(novedad).replace(/\s+/g, ' ').slice(0, 240)}`);
  return partes.join(' ');
}

// El modelo a veces rodea el JSON con texto o fences: tomamos del primer { al último }.
function parseInforme(texto) {
  const desde = texto.indexOf('{');
  const hastaIdx = texto.lastIndexOf('}');
  if (desde < 0 || hastaIdx <= desde) throw new Error('sin JSON en la respuesta');
  const informe = JSON.parse(texto.slice(desde, hastaIdx + 1));
  if (!Array.isArray(informe.grupos)) throw new Error('la respuesta no trae "grupos"');
  informe.grupos = informe.grupos.map(g => ({
    patron: String(g.patron || '').slice(0, 120),
    sintoma: String(g.sintoma || '').slice(0, 400),
    frecuencia: Number(g.frecuencia) || (Array.isArray(g.ticketIds) ? g.ticketIds.length : 0),
    ticketIds: (Array.isArray(g.ticketIds) ? g.ticketIds : []).map(Number).filter(Boolean).slice(0, 60),
    solucionTipica: String(g.solucionTipica || '').slice(0, 400),
    propuestaDeFondo: String(g.propuestaDeFondo || '').slice(0, 800),
    impacto: ['alto', 'medio', 'bajo'].includes(g.impacto) ? g.impacto : 'medio',
  }));
  informe.resumen = String(informe.resumen || '').slice(0, 1500);
  return informe;
}

// GET /asistente/analisis-tickets → el último informe generado (o null).
// Lo VE el equipo interno; generar es de conducción (decisión 07/10).
router.get('/analisis-tickets', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
  try {
    const crudo = await getConfig(CLAVE_ANALISIS);
    res.json({ analisis: crudo ? JSON.parse(crudo) : null });
  } catch (e) { next(e); }
});

// POST /asistente/analisis-tickets { desde?, hasta? } — SOLO conducción
// (controla el costo de API). Default: últimos 6 meses. Tarda 1-2 minutos.
router.post('/analisis-tickets', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const hasta = req.body?.hasta ? new Date(req.body.hasta + 'T23:59:59Z') : new Date();
    const desde = req.body?.desde ? new Date(req.body.desde + 'T00:00:00Z')
      : new Date(hasta.getTime() - 183 * 24 * 3600 * 1000); // 6 meses
    if (isNaN(desde) || isNaN(hasta) || desde > hasta) {
      throw new ApiError(400, 'bad_request', 'Período inválido');
    }

    const { total, recorte, ultimaNovedad } = await ticketsDelPeriodo(desde, hasta);
    if (recorte.length < 2) {
      throw new ApiError(400, 'bad_request',
        `El período tiene ${recorte.length} ticket(s): no hay material para buscar recurrencias. Probá con un período más largo.`);
    }

    const cuerpo = [
      `Tickets del ${desde.toISOString().slice(0, 10)} al ${hasta.toISOString().slice(0, 10)}`
      + (total > recorte.length ? ` (se analizan los ${recorte.length} más recientes de ${total})` : '')
      + `, uno por línea — formato: #id fecha [estado/origen/tipoOV/causaOV] título — descripción | última novedad:`,
      '',
      ...recorte.map(t => lineaTicket(t, ultimaNovedad[t.id])),
    ].join('\n');

    // stream:true: la generación tarda 1-3 min y sin stream el proxy de borde corta a los 100 s.
    const data = await llamarClaude({
      system: SYSTEM_ANALISIS,
      messages: [{ role: 'user', content: cuerpo }],
      maxTokens: 4000,
      stream: true,
    });
    const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let informe;
    try { informe = parseInforme(texto); } catch (e) {
      throw new ApiError(502, 'asistente_error', `La IA no devolvió un informe interpretable (${e.message}). Reintentá.`);
    }

    const analisis = {
      informe,
      periodo: { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) },
      totalPeriodo: total,
      totalAnalizados: recorte.length,
      generadoPor: req.colaborador?.nombre || null,
      generadoEl: new Date().toISOString(),
      model: data.model || null,
    };
    // Guardado del último informe (Configuracion es TEXT y el cifrado infla ~4/3:
    // si no entra, se recortan grupos — el informe igual se devuelve completo).
    try {
      let aGuardar = analisis;
      if (JSON.stringify(aGuardar).length > 45000) {
        aGuardar = { ...analisis, informe: { ...informe, grupos: informe.grupos.slice(0, 15) }, recortadoAlGuardar: true };
      }
      await setConfig(CLAVE_ANALISIS, JSON.stringify(aGuardar));
    } catch { /* el informe se devuelve igual aunque no se pueda persistir */ }

    // 07/10 bis: cada generación queda ADEMÁS archivada en el historial del
    // panel de informes (ya no se pisa la anterior — se pueden comparar períodos).
    try {
      await archivarInforme({
        tipo: 'tickets',
        titulo: `Tickets recurrentes · ${analisis.periodo.desde.split('-').reverse().join('/')} → ${analisis.periodo.hasta.split('-').reverse().join('/')}`,
        periodo: analisis.periodo,
        grupos: informe.grupos.length,
        totalAnalizados: analisis.totalAnalizados,
        generadoPor: analisis.generadoPor,
        generadoEl: analisis.generadoEl,
      }, { informe, totalPeriodo: total, totalAnalizados: recorte.length, model: data.model || null });
    } catch { /* el archivo es un extra: no rompe la generación */ }

    res.json({ analisis });
  } catch (e) { next(e); }
});

export default router;

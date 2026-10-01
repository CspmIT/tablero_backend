import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { getConfig, setConfig } from '../lib/config.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Marketing → Landing (28/09, spec de Leonardo con el proyecto de la web):
// panel de administración del contenido de la landing pública de Cooptech.
//
// Principios (del spec, decisiones de Leonardo):
//   · NADA se publica solo: la web solo ve la última versión PUBLICADA.
//   · Borrador → Publicar: el borrador es UN JSON en Configuracion
//     (`landing_borrador`, patrón simulador CoopCloud — sin migración);
//     cada publicación queda CONGELADA en la tabla LandingVersion
//     (migración aditiva 28/09) — auditable, con rollback «republicar la vN».
//   · Edita el borrador todo el que ve Marketing (collaborator incluido);
//     PUBLICA solo conducción (manager/gerencial).
//   · Los archivos se VINCULAN desde Marca (referencia {id,key,nombre} de
//     Archivo — nunca una copia): al publicar se re-resuelven por id contra
//     la base (si uno se borró en Marca, la publicación lo dice con nombre).
//
// El payload congelado guarda las URLs de archivos RELATIVAS
// (/api/landing/archivos/<key>): el GET público las absolutiza por request,
// así un cambio de host no rompe versiones viejas. `fuente` (el borrador
// usado) viaja adentro para el «Ver cambios» del frontend; `archivos` es la
// whitelist de keys que el endpoint público de binarios acepta servir.
// ---------------------------------------------------------------------------

const router = Router();

const CLAVE_BORRADOR = 'landing_borrador';
const MAX_BORRADOR = 45000; // mismo guard que el simulador (Text de MySQL)

const texto = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const esRef = (r) => r && typeof r === 'object' && Number(r.id) > 0;

async function leerBorrador() {
  const raw = await getConfig(CLAVE_BORRADOR);
  if (!raw) return null;
  try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch { return null; }
}

async function ultimaVersion() {
  return prisma.landingVersion.findFirst({ orderBy: { numero: 'desc' } });
}

const resumenDe = (v) => v && ({ numero: v.numero, createdAt: v.createdAt, publicadoPor: v.publicadoPor, notas: v.notas });

// GET /landing-admin — el borrador + la última publicación (con su fuente,
// para que el frontend arme el «Ver cambios» comparando contra el borrador).
router.get('/landing-admin', async (req, res, next) => {
  try {
    const [borrador, ultima] = await Promise.all([leerBorrador(), ultimaVersion()]);
    let ultimaFuente = null;
    if (ultima) { try { ultimaFuente = JSON.parse(ultima.payload)?.fuente ?? null; } catch { /* payload viejo */ } }
    res.json({ borrador, ultima: resumenDe(ultima) || null, ultimaFuente });
  } catch (e) { next(e); }
});

// PUT /landing-admin/borrador — autosave del borrador (todo el equipo de
// Marketing). Nada de esto llega a la web hasta que conducción publique.
router.put('/landing-admin/borrador', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
  try {
    const b = req.body?.borrador;
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad_request', 'Se espera { borrador: {...} }');
    const json = JSON.stringify(b);
    if (json.length > MAX_BORRADOR) throw new ApiError(400, 'bad_request', 'El borrador es demasiado grande para guardarse (¿se pegó contenido de más en algún texto?)');
    await setConfig(CLAVE_BORRADOR, json);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Validación al PUBLICAR (no al guardar borrador: un borrador a medias es
// normal). Solo valida lo VISIBLE — lo oculto puede estar incompleto.
// Devuelve la lista de problemas CON NOMBRE (regla de la casa: lo excluido
// o lo que falta se informa con nombre, nunca en silencio).
function validarVisibles(b) {
  const problemas = [];
  for (const [i, p] of (b.productos || []).entries()) {
    if (p.visible === false) continue;
    const donde = `Producto «${p.nombre || p.slug || `#${i + 1}`}»`;
    if (!texto(p.nombre, 100)) problemas.push(`${donde}: falta el nombre`);
    if (!esRef(p.logo)) problemas.push(`${donde}: falta el logo`);
    if (!esRef(p.placa)) problemas.push(`${donde}: falta la placa`);
    if (!texto(p.resumen, 60)) problemas.push(`${donde}: falta el resumen`);
    if (String(p.resumen || '').trim().length > 60) problemas.push(`${donde}: el resumen supera los 60 caracteres`);
    if (!texto(p.descripcion, 300)) problemas.push(`${donde}: falta la descripción`);
    if (String(p.descripcion || '').trim().length > 300) problemas.push(`${donde}: la descripción supera los 300 caracteres`);
    if (!texto(p.cta, 40)) problemas.push(`${donde}: falta el texto del botón`);
  }
  for (const [i, c] of (b.clientes || []).entries()) {
    if (c.visible === false) continue;
    if (!esRef(c.archivo)) problemas.push(`Cliente «${c.nombre || `#${i + 1}`}»: falta el logo`);
    if (!texto(c.nombre, 100)) problemas.push(`Cliente #${i + 1}: falta el nombre`);
  }
  for (const [i, h] of (b.sustentabilidad || []).entries()) {
    if (h.visible === false) continue;
    const donde = `Hito «${h.titulo || `#${i + 1}`}»`;
    if (!esRef(h.imagen)) problemas.push(`${donde}: falta la imagen`);
    if (!texto(h.titulo, 120)) problemas.push(`Hito #${i + 1}: falta el título`);
  }
  // Entrevistas «En primera persona» (28/09 bis): antes estaban hardcodeadas
  // en la web; ahora se gestionan acá como cualquier sección.
  for (const [i, e] of (b.entrevistas || []).entries()) {
    if (e.visible === false) continue;
    const donde = `Entrevista «${e.nombre || `#${i + 1}`}»`;
    if (!texto(e.nombre, 100)) problemas.push(`Entrevista #${i + 1}: falta el nombre`);
    if (!texto(e.cooperativa, 120)) problemas.push(`${donde}: falta la cooperativa`);
    if (!/^https?:\/\/\S+$/i.test(String(e.link || '').trim())) problemas.push(`${donde}: falta el link (URL completa, p. ej. la publicación de Instagram)`);
    if (!esRef(e.foto)) problemas.push(`${donde}: falta la foto`);
  }
  // Reconocimientos (28/09 ter, spec v2 de la landing): sellos académicos y
  // premios del carrusel de ADN.
  for (const [i, r] of (b.reconocimientos || []).entries()) {
    if (r.visible === false) continue;
    const donde = `Reconocimiento «${r.titulo || `#${i + 1}`}»`;
    const anio = Number(r.anio);
    if (!Number.isInteger(anio) || anio < 1990 || anio > 2100) problemas.push(`${donde}: el año no es válido`);
    if (!texto(r.tipo, 40)) problemas.push(`${donde}: falta el tipo (Congreso, IEEE Xplore, Tesis…)`);
    if (!texto(r.titulo, 60)) problemas.push(`Reconocimiento #${i + 1}: falta el título`);
    if (String(r.titulo || '').trim().length > 60) problemas.push(`${donde}: el título supera los 60 caracteres`);
    if (!texto(r.detalle, 180)) problemas.push(`${donde}: falta el detalle`);
    if (String(r.detalle || '').trim().length > 180) problemas.push(`${donde}: el detalle supera los 180 caracteres`);
    if (!esRef(r.imagen)) problemas.push(`${donde}: falta el sello (imagen)`);
    if (r.link && !/^https?:\/\/\S+$/i.test(String(r.link).trim())) problemas.push(`${donde}: el link no es una URL completa`);
  }
  // Contacto y textos de sección (28/09 quater): nada es obligatorio (la web
  // tiene defaults), pero lo cargado tiene que ser sano.
  const c = b.contacto || {};
  for (const [campo, etiqueta] of [['agendaLink', 'link de «Agendá tu reunión»'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['youtube', 'YouTube'], ['whatsapp', 'WhatsApp']]) {
    if (c[campo] && !/^https?:\/\/\S+$/i.test(String(c[campo]).trim())) problemas.push(`Contacto: el ${etiqueta} no es una URL completa (https://…)`);
  }
  if (c.email && !/^\S+@\S+\.\S+$/.test(String(c.email).trim())) problemas.push('Contacto: el email no parece válido');
  for (const [i, k] of (b.kpis || []).entries()) {
    if (k.visible === false) continue;
    if (!texto(k.valor, 30) || !texto(k.etiqueta, 120)) problemas.push(`KPI #${i + 1}: falta el valor o la etiqueta`);
  }
  return problemas;
}

// Re-resuelve TODAS las referencias {id} contra la base: la key/mime actuales
// mandan (un archivo renombrado o repisado en Marca publica su versión de hoy).
// Falta alguno → error 422 con nombre (nunca publicar con huecos silenciosos).
async function resolverArchivos(b) {
  const refs = [];
  const juntar = (r, donde) => { if (esRef(r)) refs.push({ id: Number(r.id), donde }); };
  juntar(b.portada?.video, 'Portada: video'); juntar(b.portada?.poster, 'Portada: imagen de respaldo');
  for (const p of b.productos || []) { if (p.visible === false) continue; juntar(p.logo, `Producto «${p.nombre}»: logo`); juntar(p.placa, `Producto «${p.nombre}»: placa`); juntar(p.captura, `Producto «${p.nombre}»: captura`); }
  for (const c of b.clientes || []) { if (c.visible === false) continue; juntar(c.archivo, `Cliente «${c.nombre}»: logo`); }
  for (const h of b.sustentabilidad || []) { if (h.visible === false) continue; juntar(h.imagen, `Hito «${h.titulo}»: imagen`); }
  for (const e of b.entrevistas || []) { if (e.visible === false) continue; juntar(e.foto, `Entrevista «${e.nombre}»: foto`); }
  for (const r of b.reconocimientos || []) { if (r.visible === false) continue; juntar(r.imagen, `Reconocimiento «${r.titulo}»: sello`); }
  const ids = [...new Set(refs.map((r) => r.id))];
  const filas = ids.length ? await prisma.archivo.findMany({ where: { id: { in: ids } } }) : [];
  const porId = new Map(filas.map((a) => [a.id, a]));
  const faltan = refs.filter((r) => !porId.has(r.id)).map((r) => r.donde);
  if (faltan.length) throw new ApiError(422, 'archivos_faltantes', `Estos archivos ya no están en Marca: ${faltan.join(' · ')}. Reemplazalos antes de publicar.`);
  return porId;
}

const urlDe = (ref, porId) => (esRef(ref) ? `/api/landing/archivos/${encodeURIComponent(porId.get(Number(ref.id)).key)}` : null);

// Arma el payload público CONGELADO a partir del borrador: solo visibles, en
// el orden del borrador, con URLs relativas y la whitelist de keys.
export async function armarPayload(b, publicadoPor) {
  const porId = await resolverArchivos(b);
  const visibles = (l) => (Array.isArray(l) ? l.filter((x) => x.visible !== false) : []);
  const payload = {
    publicado: new Date().toISOString(),
    publicadoPor: publicadoPor || null,
    portada: {
      video: urlDe(b.portada?.video, porId),
      poster: urlDe(b.portada?.poster, porId),
      titulo: texto(b.portada?.titulo, 200) || null,
      bajada: texto(b.portada?.bajada, 400) || null,
    },
    kpis: visibles(b.kpis).map((k) => ({ valor: texto(k.valor, 30), etiqueta: texto(k.etiqueta, 120) })),
    productos: visibles(b.productos).map((p) => ({
      id: texto(p.slug, 60) || texto(p.nombre, 60).toLowerCase().replace(/\s+/g, '-'),
      nombre: texto(p.nombre, 100),
      logo: urlDe(p.logo, porId),
      placa: urlDe(p.placa, porId),
      captura: urlDe(p.captura, porId),
      video: texto(p.video, 300) || null,
      resumen: texto(p.resumen, 60),
      descripcion: texto(p.descripcion, 300),
      cta: texto(p.cta, 40),
      simulador: p.simulador === true,
    })),
    clientes: visibles(b.clientes).map((c) => ({ nombre: texto(c.nombre, 100), logo: urlDe(c.archivo, porId) })),
    sustentabilidad: visibles(b.sustentabilidad).map((h) => ({
      titulo: texto(h.titulo, 120),
      descripcion: texto(h.descripcion, 400) || null,
      imagen: urlDe(h.imagen, porId),
      link: texto(h.link, 300) || null,
    })),
    // «En primera persona» (28/09 bis): las entrevistas dejan de estar
    // hardcodeadas en la web.
    entrevistas: visibles(b.entrevistas).map((e) => ({
      nombre: texto(e.nombre, 100),
      cooperativa: texto(e.cooperativa, 120),
      link: texto(e.link, 300),
      foto: urlDe(e.foto, porId),
      frase: texto(e.frase, 140) || null, // cita textual (spec v2; opcional)
    })),
    // Reconocimientos (28/09 ter, spec v2): orden por AÑO descendente y, dentro
    // del mismo año, el orden MANUAL del borrador (sort estable — ley de la
    // casa para listas mixtas).
    reconocimientos: visibles(b.reconocimientos)
      .map((r, idx) => ({ r, idx }))
      .sort((a, z) => (Number(z.r.anio) - Number(a.r.anio)) || (a.idx - z.idx))
      .map(({ r }) => ({
        anio: Number(r.anio),
        tipo: texto(r.tipo, 40),
        titulo: texto(r.titulo, 60),
        detalle: texto(r.detalle, 180),
        imagen: urlDe(r.imagen, porId),
        link: texto(r.link, 300) || null,
      })),
    // Contacto/CTA y títulos de sección (28/09 quater): campo vacío = null /
    // ausente → la web usa su default. Claves de textos que la web conoce:
    // productos · adn · sustentabilidad · casos · contacto.
    contacto: (() => {
      const con = b.contacto || {};
      const out = {};
      for (const k of ['agendaLink', 'email', 'telefono', 'whatsapp', 'direccion', 'instagram', 'linkedin', 'youtube']) out[k] = texto(con[k], 300) || null;
      return out;
    })(),
    textos: (() => {
      const out = {};
      for (const [clave, t] of Object.entries(b.textos || {})) {
        const titulo = texto(t?.titulo, 80); const bajada = texto(t?.bajada, 220);
        if (titulo || bajada) out[String(clave).slice(0, 40)] = { titulo: titulo || null, bajada: bajada || null };
      }
      return out;
    })(),
    archivos: [...new Set([...porId.values()].map((a) => a.key))], // whitelist del endpoint público de binarios
    fuente: b, // el borrador usado — para «Ver cambios» y para retomar desde una versión
  };
  return payload;
}

// POST /landing-admin/publicar — solo conducción. Congela la versión.
router.post('/landing-admin/publicar', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const b = await leerBorrador();
    if (!b) throw new ApiError(400, 'sin_borrador', 'Todavía no hay borrador para publicar');
    const problemas = validarVisibles(b);
    if (problemas.length) throw new ApiError(422, 'borrador_incompleto', problemas.join(' · '));
    const payload = await armarPayload(b, req.colaborador?.nombre || null);
    const ultima = await ultimaVersion();
    const numero = (ultima?.numero || 0) + 1;
    const v = await prisma.landingVersion.create({
      data: { numero, payload: JSON.stringify(payload), publicadoPor: req.colaborador?.nombre || null, notas: texto(req.body?.notas, 191) || null },
    });
    res.status(201).json({ ok: true, version: resumenDe(v) });
  } catch (e) { next(e); }
});

// GET /landing-admin/versiones — historial (para el rollback).
router.get('/landing-admin/versiones', async (req, res, next) => {
  try {
    const filas = await prisma.landingVersion.findMany({ orderBy: { numero: 'desc' }, take: 50, select: { numero: true, createdAt: true, publicadoPor: true, notas: true } });
    res.json({ versiones: filas });
  } catch (e) { next(e); }
});

// POST /landing-admin/versiones/:numero/republicar — rollback: copia el
// payload congelado de la vN como versión NUEVA (la web siempre sirve la
// última; el historial nunca se reescribe).
router.post('/landing-admin/versiones/:numero/republicar', requireTipo('manager', 'gerencial'), async (req, res, next) => {
  try {
    const origen = await prisma.landingVersion.findUnique({ where: { numero: Number(req.params.numero) } });
    if (!origen) throw new ApiError(404, 'not_found', 'Esa versión no existe');
    const ultima = await ultimaVersion();
    let payload;
    try { payload = JSON.parse(origen.payload); } catch { throw new ApiError(500, 'payload_corrupto', 'El payload de esa versión no se pudo leer'); }
    payload.publicado = new Date().toISOString();
    payload.publicadoPor = req.colaborador?.nombre || null;
    const v = await prisma.landingVersion.create({
      data: {
        numero: (ultima?.numero || 0) + 1,
        payload: JSON.stringify(payload),
        publicadoPor: req.colaborador?.nombre || null,
        notas: `Republicación de la v${origen.numero}`,
      },
    });
    res.status(201).json({ ok: true, version: resumenDe(v) });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Bandeja «Consultas web» (28/09): lo que entra por el POST público de la
// landing. La lee el equipo del CRM; convertir/descartar es del equipo interno.
// «Convertir en lead» lo hace el FRONTEND con el formulario +Lead precargado
// (reusa sus validaciones) y después marca acá la consulta como convertida.
// ---------------------------------------------------------------------------

router.get('/landing-consultas', async (req, res, next) => {
  try {
    const where = req.query.estado ? { estado: String(req.query.estado) } : {};
    const data = await prisma.landingConsulta.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const nuevas = await prisma.landingConsulta.count({ where: { estado: 'nueva' } });
    res.json({ data, nuevas });
  } catch (e) { next(e); }
});

router.patch('/landing-consultas/:id', requireTipo('manager', 'gerencial', 'collaborator'), async (req, res, next) => {
  try {
    const estado = String(req.body?.estado || '').trim();
    if (!['nueva', 'convertida', 'descartada'].includes(estado)) throw new ApiError(400, 'bad_request', 'Estado inválido');
    const data = { estado };
    if (estado === 'convertida' && req.body?.leadId) data.leadId = Number(req.body.leadId) || null;
    const c = await prisma.landingConsulta.update({ where: { id: Number(req.params.id) }, data });
    res.json(c);
  } catch (e) { next(e); }
});

export default router;

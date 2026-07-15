// Calidad de datos de etiquetas (tags). Las etiquetas de la grilla eran texto
// libre y generaron variantes ("masagua", "+Agua", "MasAgua"...) que rompen las
// estadísticas de horas por proyecto (prueba estrella del TFI y caso A del
// asistente). Este router permite ver el uso real y UNIFICAR variantes.
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireTipo } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();

// GET /etiquetas/sugerencias → nombres únicos en uso (registro Tag + grilla),
// ordenados por frecuencia. Abierto a todos los aprovisionados: alimenta el
// autocompletado del editor del día. (Las rutas de administración, más abajo,
// siguen siendo solo-manager.)
router.get('/sugerencias', async (req, res, next) => {
  try {
    const [entradas, registro] = await Promise.all([
      prisma.grillaEntrada.findMany({ where: { NOT: { items: { equals: null } } }, select: { items: true } }),
      prisma.tag.findMany({ select: { nombre: true } }),
    ]);
    const freq = new Map();
    for (const t of registro) freq.set(t.nombre, (freq.get(t.nombre) || 0) + 1);
    for (const e of entradas) {
      for (const it of (Array.isArray(e.items) ? e.items : [])) {
        for (const t of (Array.isArray(it?.tags) ? it.tags : [])) {
          const n = String(t);
          freq.set(n, (freq.get(n) || 0) + 1);
        }
      }
    }
    const nombres = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    res.json({ sugerencias: nombres });
  } catch (e) { next(e); }
});

router.use(requireTipo('manager'));

// Normalización: minúsculas, sin acentos, solo alfanumérico ("Mas Agua" → "masagua").
export const normalizarTag = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// GET /etiquetas/uso → todas las etiquetas en uso con conteos, agrupables por
// clave normalizada. Fuentes: items de la grilla + registro Tag (kanban/objetivos).
router.get('/uso', async (req, res, next) => {
  try {
    // ?anio=YYYY filtra: grilla por fecha del día; kanban por fecha de alta de
    // la tarea. Sin anio → total histórico de toda la plataforma.
    const anio = Number(req.query.anio) || null;
    const whereGrilla = { NOT: { items: { equals: null } } };
    if (anio) whereGrilla.fecha = { gte: new Date(`${anio}-01-01`), lte: new Date(`${anio}-12-31`) };
    const [entradas, registro, puentesKanban] = await Promise.all([
      prisma.grillaEntrada.findMany({ where: whereGrilla, select: { items: true } }),
      prisma.tag.findMany({ select: { id: true, nombre: true } }),
      prisma.tareaTag.findMany({ select: { tagId: true, tarea: { select: { createdAt: true } } } }),
    ]);
    const usoKanban = [];
    const porTag = {};
    for (const p of puentesKanban) {
      if (anio && p.tarea?.createdAt && new Date(p.tarea.createdAt).getFullYear() !== anio) continue;
      porTag[p.tagId] = (porTag[p.tagId] || 0) + 1;
    }
    for (const [tagId, n] of Object.entries(porTag)) usoKanban.push({ tagId: Number(tagId), _count: { tagId: n } });

    const conteo = new Map(); // nombre exacto -> { grilla, kanban, enRegistro }
    const toca = (nombre) => {
      if (!conteo.has(nombre)) conteo.set(nombre, { tag: nombre, grilla: 0, kanban: 0, enRegistro: false });
      return conteo.get(nombre);
    };
    for (const e of entradas) {
      for (const it of (Array.isArray(e.items) ? e.items : [])) {
        for (const t of (Array.isArray(it?.tags) ? it.tags : [])) toca(String(t)).grilla += 1;
      }
    }
    const kanbanPorId = Object.fromEntries(usoKanban.map(u => [u.tagId, u._count.tagId]));
    for (const t of registro) {
      const c = toca(t.nombre);
      c.enRegistro = true;
      c.kanban = kanbanPorId[t.id] || 0;
    }

    const lista = [...conteo.values()]
      .map(c => ({ ...c, normal: normalizarTag(c.tag), total: c.grilla + c.kanban }))
      .filter(c => !anio || c.total > 0 || c.enRegistro)
      .sort((a, b) => a.normal.localeCompare(b.normal) || b.total - a.total);
    res.json({ etiquetas: lista, anio });
  } catch (e) { next(e); }
});

// GET /etiquetas/detalle?tag=X[&anio=YYYY] → las tareas detrás del contador:
// ítems de la grilla (fecha, colaborador, texto, horas declaradas) + cards del
// kanban, con matching por clave normalizada (agrupa variantes de escritura).
router.get('/detalle', async (req, res, next) => {
  try {
    const clave = normalizarTag(req.query.tag);
    if (!clave) throw new ApiError(400, 'bad_request', 'Falta el tag');
    const anio = Number(req.query.anio) || null;
    const whereGrilla = { NOT: { items: { equals: null } } };
    if (anio) whereGrilla.fecha = { gte: new Date(`${anio}-01-01`), lte: new Date(`${anio}-12-31`) };

    const [entradas, colaboradores, tags] = await Promise.all([
      prisma.grillaEntrada.findMany({ where: whereGrilla, select: { colaboradorId: true, fecha: true, items: true }, orderBy: { fecha: 'desc' } }),
      prisma.colaborador.findMany({ select: { id: true, nombre: true } }),
      prisma.tag.findMany({ select: { id: true, nombre: true } }),
    ]);
    const nombrePor = Object.fromEntries(colaboradores.map(c => [c.id, c.nombre]));

    const itemsGrilla = [];
    for (const e of entradas) {
      for (const it of (Array.isArray(e.items) ? e.items : [])) {
        const tgs = Array.isArray(it?.tags) ? it.tags : [];
        if (!tgs.some(t => normalizarTag(t) === clave)) continue;
        itemsGrilla.push({
          fecha: e.fecha.toISOString().slice(0, 10),
          colaborador: nombrePor[e.colaboradorId] || `#${e.colaboradorId}`,
          texto: String(it.text || ''),
          horas: Number(it.horas) > 0 ? Number(it.horas) : null,
        });
      }
    }

    const idsTag = tags.filter(t => normalizarTag(t.nombre) === clave).map(t => t.id);
    let cards = [];
    if (idsTag.length) {
      const whereTarea = { tags: { some: { tagId: { in: idsTag } } } };
      if (anio) whereTarea.createdAt = { gte: new Date(`${anio}-01-01`), lte: new Date(`${anio}-12-31T23:59:59`) };
      cards = (await prisma.tarea.findMany({
        where: whereTarea,
        select: { titulo: true, kanbanCol: true, proyecto: { select: { nombre: true } } },
        orderBy: { createdAt: 'desc' }, take: 100,
      })).map(t => ({ titulo: t.titulo, columna: t.kanbanCol, proyecto: t.proyecto?.nombre || null }));
    }

    res.json({ tag: req.query.tag, anio, itemsGrilla, cards });
  } catch (e) { next(e); }
});

// POST /etiquetas/unificar { variantes: [string], canonico: string }
// Remapea las variantes al nombre canónico en: items de la grilla, registro Tag
// (re-apuntando TareaTag/ObjetivoTag y eliminando los Tag variantes). Todo en
// una transacción. El canónico queda en el registro (alimenta el autocompletado).
router.post('/unificar', async (req, res, next) => {
  try {
    const canonico = String(req.body?.canonico || '').trim();
    const variantes = (Array.isArray(req.body?.variantes) ? req.body.variantes : [])
      .map(v => String(v)).filter(v => v && v !== canonico);
    if (!canonico) throw new ApiError(400, 'bad_request', 'Falta el nombre canónico');
    if (!variantes.length) throw new ApiError(400, 'bad_request', 'Indicá al menos una variante a unificar');
    const setVariantes = new Set(variantes);

    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Grilla: remapear tags dentro del JSON de items.
      const entradas = await tx.grillaEntrada.findMany({
        where: { NOT: { items: { equals: null } } },
        select: { colaboradorId: true, fecha: true, items: true },
      });
      let diasTocados = 0;
      for (const e of entradas) {
        const items = Array.isArray(e.items) ? e.items : [];
        let cambio = false;
        const nuevos = items.map(it => {
          const tags = Array.isArray(it?.tags) ? it.tags : [];
          if (!tags.some(t => setVariantes.has(String(t)))) return it;
          cambio = true;
          const remap = tags.map(t => setVariantes.has(String(t)) ? canonico : t);
          return { ...it, tags: [...new Set(remap)] };
        });
        if (cambio) {
          diasTocados += 1;
          await tx.grillaEntrada.update({
            where: { colaboradorId_fecha: { colaboradorId: e.colaboradorId, fecha: e.fecha } },
            data: { items: nuevos },
          });
        }
      }

      // 2. Registro: asegurar el Tag canónico y re-apuntar puentes de las variantes.
      const tagCanonico = await tx.tag.upsert({
        where: { nombre: canonico }, update: {}, create: { nombre: canonico },
      });
      const tagsVariantes = await tx.tag.findMany({ where: { nombre: { in: variantes } } });
      let puentesMovidos = 0;
      for (const tv of tagsVariantes) {
        for (const modelo of ['tareaTag', 'objetivoTag']) {
          const idCampo = modelo === 'tareaTag' ? 'tareaId' : 'objetivoId';
          const puentes = await tx[modelo].findMany({ where: { tagId: tv.id } });
          for (const p of puentes) {
            const existe = await tx[modelo].findUnique({
              where: modelo === 'tareaTag'
                ? { tareaId_tagId: { tareaId: p.tareaId, tagId: tagCanonico.id } }
                : { objetivoId_tagId: { objetivoId: p.objetivoId, tagId: tagCanonico.id } },
            });
            if (existe) await tx[modelo].delete({
              where: modelo === 'tareaTag'
                ? { tareaId_tagId: { tareaId: p.tareaId, tagId: tv.id } }
                : { objetivoId_tagId: { objetivoId: p.objetivoId, tagId: tv.id } },
            });
            else await tx[modelo].update({
              where: modelo === 'tareaTag'
                ? { tareaId_tagId: { tareaId: p.tareaId, tagId: tv.id } }
                : { objetivoId_tagId: { objetivoId: p.objetivoId, tagId: tv.id } },
              data: { tagId: tagCanonico.id },
            });
            puentesMovidos += 1;
          }
        }
        await tx.tag.delete({ where: { id: tv.id } });
      }
      return { diasTocados, puentesMovidos, variantesEliminadas: tagsVariantes.length };
    }, { timeout: 30000 });

    res.json({ ok: true, canonico, ...resultado });
  } catch (e) { next(e); }
});

export default router;

// Conector con la Mesa de ayuda de la cooperativa (24/08 — ola 2 del Inbox).
// La Mesa (software de Guillermo) expone la API de exportación definida en
// `Instructivo_API_MesaAyuda_para_Guillermo.md`: GET /api/export/tickets con
// Bearer, filtro por área y cursor `since` por updatedAt. Este módulo la
// consume y hace UPSERT por `externalId` (por eso el campo nació @unique el
// 20/08: la sincronización es idempotente — correrla mil veces da lo mismo).
//
// Config en Configuracion (claves JSON, se cargan desde el Inbox, gestores):
//   mesa_ayuda_url    base de la Mesa (ej: https://mesadeayuda.coopmorteros.coop)
//   mesa_ayuda_token  Bearer (vive SOLO acá, del lado del servidor — jamás en
//                     el bundle del frontend)
//   mesa_ayuda_area   área a traer (default 'Oficina Virtual' — decisión 24/08;
//                     originalmente iba a ser 'Desarrollo')
//   mesa_ayuda_since  cursor (ISO del último updatedAt visto)
//   mesa_ayuda_ultimo resultado de la última corrida (para mostrar en la vista)
//
// Los adjuntos y mensajes del contrato quedan para una pasada siguiente (el
// upsert del ticket es lo que alimenta las Métricas OV, que es lo urgente).
import { prisma } from './prisma.js';
import { getConfig, setConfig } from './config.js';

const ESTADOS = ['abierto', 'en_proceso', 'resuelto', 'cerrado'];
const mapEstado = (v) => {
  const e = String(v || '').toLowerCase().replace(/\s+/g, '_');
  if (ESTADOS.includes(e)) return e;
  if (e === 'reabierto') return 'abierto';
  return 'abierto';
};
const fecha = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const texto = (v, max = 191) => String(v ?? '').trim().slice(0, max) || null;

let corriendo = false; // candado simple: una corrida a la vez

export async function estadoSync() {
  const [url, token, area, since, ultimoRaw] = await Promise.all([
    getConfig('mesa_ayuda_url'), getConfig('mesa_ayuda_token'),
    getConfig('mesa_ayuda_area'), getConfig('mesa_ayuda_since'), getConfig('mesa_ayuda_ultimo'),
  ]);
  let ultimo = null;
  try { ultimo = ultimoRaw ? JSON.parse(ultimoRaw) : null; } catch { /* vacío */ }
  return {
    configurado: Boolean(url && token),
    url: url || null,
    area: area || 'Oficina Virtual',
    tieneToken: Boolean(token), // el token NUNCA viaja al frontend
    since: since || null,
    ultimo,
  };
}

export async function guardarConfigSync({ url, token, area }) {
  if (url !== undefined) await setConfig('mesa_ayuda_url', String(url || '').trim().replace(/\/+$/, ''));
  if (token !== undefined && String(token).trim()) await setConfig('mesa_ayuda_token', String(token).trim());
  if (area !== undefined) await setConfig('mesa_ayuda_area', String(area || '').trim() || 'Oficina Virtual');
}

// Corre UNA sincronización completa. Nunca lanza: devuelve el resumen y lo
// persiste en mesa_ayuda_ultimo para que la vista lo muestre.
export async function sincronizarMesaAyuda(disparo = 'manual') {
  if (corriendo) return { ok: false, motivo: 'ya_corriendo' };
  corriendo = true;
  const resumen = { ok: false, disparo, inicio: new Date().toISOString(), creados: 0, actualizados: 0, paginas: 0, error: null };
  try {
    const url = await getConfig('mesa_ayuda_url');
    const token = await getConfig('mesa_ayuda_token');
    const area = (await getConfig('mesa_ayuda_area')) || 'Oficina Virtual';
    if (!url || !token) { resumen.error = 'Falta configurar URL y token de la Mesa de ayuda'; return resumen; }

    let since = (await getConfig('mesa_ayuda_since')) || '';
    let mayorUpdatedAt = since;
    let next = null;

    do {
      const qs = new URLSearchParams({ area, limit: '100' });
      if (next) qs.set('since', next); else if (since) qs.set('since', since);
      const res = await fetch(`${url}/api/export/tickets?${qs}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (res.status === 401) { resumen.error = 'La Mesa rechazó el token (401) — verificar con Guillermo'; break; }
      if (!res.ok) { resumen.error = `La Mesa respondió HTTP ${res.status}`; break; }
      const data = await res.json();
      const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
      resumen.paginas += 1;

      for (const t of tickets) {
        const externalId = texto(t.id, 100);
        if (!externalId || !texto(t.titulo)) continue; // sin id o título no hay upsert sano
        // ANTI-ECO (27/08, acuerdo con Guillermo): si el último cambio de estado
        // lo hizo el propio tablero (nuestro PATCH), NO pisamos el estado local —
        // los dos sistemas dejarían de avisarse de lo mismo en círculos.
        const esEco = /tablero/i.test(String(t.ultimoCambioPor || ''));
        const campos = {
          titulo: texto(t.titulo) || '(sin título)',
          descripcion: String(t.descripcion || '').trim() || '(sin descripción)',
          sector: texto(t.sector),
          solicitante: texto(t.solicitante),
          tipo: texto(t.tipo, 60) || 'Incidente',
          prioridad: texto(t.prioridad, 60) || 'Media',
          area: texto(t.area, 100) || area,
          copiarA: Array.isArray(t.copiarA) ? t.copiarA.join(', ') : (texto(t.copiarA, 500)),
          origen: 'mesa_ayuda',
          ocurridoAt: fecha(t.createdAt),
          ...(esEco ? {} : {
            estado: mapEstado(t.estado),
            resueltoAt: fecha(t.resueltoAt),
            cerradoAt: fecha(t.cerradoAt),
          }),
        };
        const existente = await prisma.ticket.findUnique({ where: { externalId }, select: { id: true } });
        let ticketId;
        if (existente) {
          // La clasificación OV, la categoría a/b/c, el vínculo a grilla y la
          // asignación son NUESTROS — el upsert no los toca jamás.
          await prisma.ticket.update({ where: { externalId }, data: campos });
          ticketId = existente.id;
          resumen.actualizados += 1;
        } else {
          const creado = await prisma.ticket.create({ data: { ...campos, estado: campos.estado || mapEstado(t.estado), externalId } });
          ticketId = creado.id;
          resumen.creados += 1;
        }
        // REAPERTURA (27/08 — «la novedad más importante que existe»: el equipo
        // creía que estaba terminado y el solicitante lo reabrió). Entra como
        // MENSAJE en el hilo, numerado para ser idempotente (no se duplica).
        const nReap = Number(t.reaperturas || 0);
        if (nReap > 0) {
          const textoReap = `⚠ Reabierto por el solicitante (reapertura #${nReap})${t.motivoReapertura ? `: ${String(t.motivoReapertura).trim()}` : ''}`;
          const ya = await prisma.ticketMensaje.findFirst({ where: { ticketId, texto: textoReap }, select: { id: true } });
          if (!ya) await prisma.ticketMensaje.create({ data: { ticketId, autor: 'Mesa de ayuda', texto: textoReap } });
        }
        // AVISO DE BAJA (acuerdo 3): el ticket cambió de área y deja de ser
        // nuestro — queda reflejado con su área nueva y no se actualiza más.
        if (t.baja) { /* el área nueva ya viajó en campos.area; nada más que hacer */ }
        const u = texto(t.updatedAt, 40);
        if (u && (!mayorUpdatedAt || u > mayorUpdatedAt)) mayorUpdatedAt = u;
      }
      next = texto(data?.next, 60);
    } while (next && resumen.paginas < 50); // tope defensivo de páginas

    if (!resumen.error) {
      resumen.ok = true;
      if (mayorUpdatedAt && mayorUpdatedAt !== since) await setConfig('mesa_ayuda_since', mayorUpdatedAt);
    }
  } catch (e) {
    resumen.error = e.message || 'No se pudo hablar con la Mesa de ayuda';
  } finally {
    resumen.fin = new Date().toISOString();
    try { await setConfig('mesa_ayuda_ultimo', JSON.stringify(resumen)); } catch { /* la vista mostrará el anterior */ }
    corriendo = false;
  }
  return resumen;
}

// CICLO COMPLETO (24/08, decisión de Leonardo): el equipo NO tiene usuarios
// resolutores en la Mesa — si el cierre no viaja de vuelta, sus tickets quedan
// eternamente abiertos allá. Cuando el tablero cambia el ESTADO de un ticket
// con origen mesa_ayuda, se lo avisa a la Mesa (PATCH del instructivo, mismo
// Bearer). Nunca lanza: devuelve { ok, motivo } y el frontend muestra el aviso
// si la Mesa no respondió (en ese caso la próxima sincronización puede volver
// a traer el estado viejo — es honesto mostrarlo, no esconderlo).
export async function avisarEstadoMesa(externalId, { estado, comentario } = {}) {
  try {
    const url = await getConfig('mesa_ayuda_url');
    const token = await getConfig('mesa_ayuda_token');
    if (!url || !token) return { ok: false, motivo: 'sin_config' };
    const res = await fetch(`${url}/api/export/tickets/${encodeURIComponent(externalId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ estado, ...(comentario ? { comentario } : {}) }),
    });
    if (!res.ok) return { ok: false, motivo: `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e.message || 'sin_red' };
  }
}

// Corrida periódica (cada 5 minutos, como promete el instructivo). Silenciosa
// si no está configurada; los errores quedan en mesa_ayuda_ultimo.
export function iniciarSyncPeriodico() {
  const CADA = 5 * 60 * 1000;
  setInterval(async () => {
    try {
      const url = await getConfig('mesa_ayuda_url');
      const token = await getConfig('mesa_ayuda_token');
      if (url && token) await sincronizarMesaAyuda('periodico');
    } catch { /* siguiente vuelta */ }
  }, CADA).unref?.();
}

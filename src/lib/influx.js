// Laboratorio (10/09): cliente mínimo de la API v2 de InfluxDB para ejecutar
// los borrados de la cola `LabBorrado` contra el servidor guardado en
// `LabServidor`. Migrado de `Influx/delete_influx` de la Oficina Virtual:
//   1. consulta si hay datos del tópico en el rango,
//   2. si hay, los borra con el predicado topic="…",
//   3. espera 1 s y vuelve a consultar para verificar.
// Usa el fetch nativo de Node (sin librería). Solo toca el bucket y el tópico
// indicados; el resto es lectura.
//
// Campos de LabServidor para un servidor Influx (decisión 10/09, sin cambiar
// el esquema): `contrasena` = token de API, `usuario` = organización (si está
// vacío se usa INFLUX_ORG o "CoopMorteros"), `url` + `puerto` = base.

const TIMEOUT_MS = Number(process.env.INFLUX_TIMEOUT_MS || 15000);
const ORG_DEFAULT = process.env.INFLUX_ORG || 'CoopMorteros';

// Error "para la persona": el mensaje va derecho a `LabBorrado.resultado`.
export class InfluxError extends Error {
  constructor(mensaje, detalle) {
    super(mensaje);
    this.detalle = detalle;
  }
}

// "200.63.120.50" + puerto 18086 → "http://200.63.120.50:18086";
// "https://influx.coop/" → "https://influx.coop". El puerto del campo solo se
// usa si la URL no trae uno.
export function baseUrlDe(servidor) {
  let url = String(servidor?.url || '').trim();
  if (!url) throw new InfluxError('El servidor InfluxDB no tiene URL cargada.');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  let u;
  try { u = new URL(url); } catch { throw new InfluxError(`La URL del servidor InfluxDB no es válida (${servidor.url}).`); }
  if (servidor.puerto && !u.port) u.port = String(servidor.puerto);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export function credencialesDe(servidor) {
  const token = String(servidor?.contrasena || '').trim();
  if (!token) throw new InfluxError('El servidor InfluxDB no tiene cargado el token de API (campo Token).');
  return {
    baseUrl: baseUrlDe(servidor),
    token,
    org: String(servidor?.usuario || '').trim() || ORG_DEFAULT,
  };
}

// Dentro de un string de Flux / del predicado de borrado solo hay que escapar
// la barra invertida y la comilla doble. El PHP viejo concatenaba el tópico crudo.
export const escaparCadena = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamar(url, { method = 'GET', headers = {}, body, token }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers: { Authorization: `Token ${token}`, ...headers },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new InfluxError(`El servidor InfluxDB no respondió en ${Math.round(TIMEOUT_MS / 1000)} segundos.`, String(e));
    }
    const code = e?.cause?.code || e?.code || '';
    throw new InfluxError(`No se pudo conectar con el servidor InfluxDB${code ? ` (${code})` : ''}. Revisá la URL y el puerto.`, String(e?.cause || e));
  } finally {
    clearTimeout(timer);
  }
}

async function errorDeRespuesta(res, contexto) {
  let detalle = '';
  try {
    const texto = await res.text();
    try { detalle = JSON.parse(texto)?.message || texto; } catch { detalle = texto; }
  } catch { /* sin cuerpo */ }
  detalle = String(detalle || '').trim().slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    return new InfluxError('El servidor InfluxDB rechazó el token: no tiene permiso para esta operación.', detalle);
  }
  if (res.status === 404) {
    return new InfluxError('El servidor InfluxDB no encontró el bucket o la organización indicados.', detalle);
  }
  return new InfluxError(`El servidor InfluxDB respondió con error ${res.status} al ${contexto}${detalle ? `: ${detalle}` : '.'}`, detalle);
}

// true si existe al menos un punto del tópico en [desde, hasta). Usa limit(n: 1)
// en lugar del aggregateWindow(1m) del PHP: misma respuesta sí/no, mucho menos
// trabajo para Influx.
export async function hayDatos({ baseUrl, token, org, bucket, desde, hasta, topico }) {
  const flux = [
    `from(bucket: "${escaparCadena(bucket)}")`,
    `|> range(start: ${iso(desde)}, stop: ${iso(hasta)})`,
    `|> filter(fn: (r) => r["topic"] == "${escaparCadena(topico)}")`,
    '|> limit(n: 1)',
  ].join(' ');
  const res = await llamar(`${baseUrl}/api/v2/query?org=${encodeURIComponent(org)}`, {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
    body: flux,
  });
  if (!res.ok) throw await errorDeRespuesta(res, 'consultar los datos');
  const csv = await res.text();
  // CSV anotado: líneas "#..." son anotaciones, la cabecera empieza con
  // ",result,table"; cualquier otra línea no vacía es un dato.
  return csv.split(/\r?\n/).some((l) => l.trim() && !l.startsWith('#') && !/^,?result,table/.test(l));
}

// Borra todos los puntos del tópico en [desde, hasta) del bucket.
export async function borrarSerie({ baseUrl, token, org, bucket, desde, hasta, topico }) {
  const res = await llamar(
    `${baseUrl}/api/v2/delete?org=${encodeURIComponent(org)}&bucket=${encodeURIComponent(bucket)}`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: iso(desde), stop: iso(hasta), predicate: `topic="${escaparCadena(topico)}"` }),
    },
  );
  if (!res.ok) throw await errorDeRespuesta(res, 'borrar los datos');
}

// Flujo completo de una solicitud. Devuelve { estado, resultado } listo para
// guardar en LabBorrado. Los errores de conexión/permiso salen como InfluxError.
export async function ejecutarBorrado(servidor, { bucket, desde, hasta, topico }) {
  const args = { ...credencialesDe(servidor), bucket, desde, hasta, topico };
  if (!(await hayDatos(args))) {
    return { estado: 'sin_datos', resultado: 'No había datos de ese tópico en el rango indicado. No se borró nada.' };
  }
  await borrarSerie(args);
  await esperar(1000);
  if (await hayDatos(args)) {
    return { estado: 'error', resultado: 'El borrado se ejecutó pero siguen apareciendo datos en el rango. Probá de nuevo en un minuto.' };
  }
  return { estado: 'ejecutado', resultado: 'Datos borrados y verificados: el rango quedó vacío para ese tópico.' };
}

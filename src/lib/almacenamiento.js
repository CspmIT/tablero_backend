// Borrado del BINARIO en el gateway de almacenamiento (storageov → MinIO).
//
// Hasta el 21/08 el gateway no exponía borrado: al eliminar un archivo desde la
// app se iba la referencia y el binario quedaba para siempre. Ahora hay dos
// endpoints, uno por cada camino de subida:
//
//   DELETE /minio/deleteImg/<bucket>/<fileName>        lo que subió saveImage()
//   DELETE /minio/deleteRelease/<release>/<path>       los pesados en partes
//
// Los dos son idempotentes (si el objeto ya no está responden 200 con
// removed:false), así que reintentar no es un problema.
//
// Va en el BACKEND y no en el navegador a propósito: borrar es destructivo y las
// credenciales del frontend viajan en el bundle de Vite. Acá quedan del lado del
// servidor y hay un solo lugar donde ocurre el borrado, para todos los módulos.
//
// Si las credenciales no están configuradas, el borrado del binario se saltea con
// un aviso en el log: la referencia igual se borra y la app sigue funcionando
// (que un archivo quede huérfano en MinIO no justifica hacer fallar la operación
// que el usuario pidió).

const BASE = (process.env.STORAGE_URL || 'https://storageov.cooptech.com.ar').replace(/\/+$/, '');
const BUCKET = process.env.STORAGE_BUCKET || 'tablero';
const ACCESS = process.env.STORAGE_ACCESS;
const SECRET = process.env.STORAGE_SECRET;

// Marca que usa el frontend para los pesados: 'release:<release>/<path>'.
const PREFIJO_RELEASE = 'release:';

let avisoFaltanCredenciales = false;

export const almacenamientoConfigurado = () => Boolean(ACCESS && SECRET);

// URL de borrado según la forma de la key. null si la key no sirve.
export function urlDeBorrado(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (k.startsWith(PREFIJO_RELEASE)) {
    const ruta = k.slice(PREFIJO_RELEASE.length);
    // Tiene que traer release + path, y nada de saltos hacia arriba.
    if (!ruta.includes('/') || ruta.includes('..') || ruta.startsWith('/')) return null;
    return `${BASE}/minio/deleteRelease/${ruta.split('/').map(encodeURIComponent).join('/')}`;
  }
  // Camino común: nombre plano (uuid + extensión), sin subcarpetas.
  if (k.includes('/') || k.includes('..')) return null;
  return `${BASE}/minio/deleteImg/${encodeURIComponent(BUCKET)}/${encodeURIComponent(k)}`;
}

// Borra el binario. Nunca lanza: devuelve { ok, motivo } y deja rastro en el log
// cuando algo no salió, para poder limpiar a mano si hiciera falta.
export async function borrarBinario(key) {
  if (!almacenamientoConfigurado()) {
    if (!avisoFaltanCredenciales) {
      avisoFaltanCredenciales = true;
      console.warn('[almacenamiento] STORAGE_ACCESS/STORAGE_SECRET sin configurar: los binarios quedan en MinIO al borrar referencias');
    }
    return { ok: false, motivo: 'sin_credenciales' };
  }
  const url = urlDeBorrado(key);
  if (!url) {
    console.warn('[almacenamiento] key con forma inesperada, no se borró el binario:', key);
    return { ok: false, motivo: 'key_invalida' };
  }
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { accesskey: ACCESS, secretkey: SECRET },
    });
    if (!res.ok) {
      console.warn('[almacenamiento] el gateway no borró', key, '→', res.status, (await res.text().catch(() => '')).slice(0, 200));
      return { ok: false, motivo: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[almacenamiento] no se pudo hablar con el gateway para borrar', key, '→', e.message);
    return { ok: false, motivo: 'sin_red' };
  }
}

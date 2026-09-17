# Catálogo de firmwares para Reconecta (AutonomIA) — qué hay que implementar acá

Documento de traspaso: todo el contexto y el código para agregar al Tablero un
endpoint de solo lectura que exponga el catálogo de firmwares aprobados a otra
aplicación del ecosistema. Está pensado para trabajarse desde este repo
(`tablero_backend`) sin tener que mirar el de Reconecta.

Fecha: 17/09/2026. Rama sobre la que se verificó: `juan`.

**Estado: nada de esto está implementado todavía.** A esta fecha, en `juan` no
existe `src/routes/catalogoFirmwares.js` ni ninguno de los cambios de la sección
2: lo único que hay en el árbol es este documento. Es un plan, no una bitácora.

---

## 1. Por qué

Reconecta incorporó **AutonomIA**, el módulo que usa el instalador en campo para
programar y configurar las placas Multivac (Configuración → AutonomIA). Los
releases de firmware los sigue publicando y aprobando ingeniería **acá**, en
«Gestión de versiones»; Reconecta solamente los consume: lee el catálogo, baja
los `.bin` del storage y flashea.

Para leer el catálogo, el backend de Reconecta necesita autenticarse **sin un
usuario humano detrás**. Hoy no hay forma de hacerlo bien:

- `GET /api/multivac/firmwares` está detrás de `authenticate` +
  `requireProvisioned` (`routes/index.js`: el `router.use(requireProvisioned)`
  cubre todo el router). En producción el contenedor corre con `AUTH_MODE=prod`
  (ver `Dockerfile`), así que sin JWT válido responde 401.
- `POST /api/auth/loginCooptech { email, tokenApp }` es público y devolvería un
  JWT de 30 días para un "colaborador de servicio", sin tocar una línea de este
  repo. **Se descartó**: `/multivac` no tiene restricción por tipo de
  colaborador, así que ese JWT abre toda la API del tablero (CRM, costos,
  tickets, leads) para leer un catálogo de firmwares.

La solución elegida es la de menor alcance: **una API key de solo lectura que
devuelve únicamente los releases aprobados**.

> Si al leer esto se te ocurre resolverlo con el usuario de servicio: ya se
> evaluó y se descartó por lo de arriba. La decisión está tomada.

---

## 2. Qué hay que hacer

Seis archivos, más la variable en el `.env` para poder probarlo. Nada de lo
existente cambia de comportamiento.

| Archivo | Cambio |
|---|---|
| `src/routes/catalogoFirmwares.js` | **Nuevo** — el router |
| `src/app.js` | Importar y montar `/api/catalogo` **antes** de `authenticate` |
| `src/routes/multivac.js` | Exportar `CLAVE_FIRMWARES` y `PRODUCTOS_FW` (agregar `export`, nada más) |
| `Dockerfile` | `ARG` + `ENV` de `FIRMWARES_API_KEY` |
| `.github/workflows/cicd.yml` | `--build-arg FIRMWARES_API_KEY=${{ secrets.FIRMWARES_API_KEY }}` |
| `CONFIG_INTEGRACIONES.md` | Sección nueva con la variable (formato de las secciones 1-3) |
| `.env` (local, no versionado) | `FIRMWARES_API_KEY=...` para probar; sin ella todo responde 503 |

No hace falta tocar `openapi.json`: `/multivac` tampoco está documentado ahí.

Contrato del endpoint:

```
GET /api/catalogo/firmwares[?producto=Reconecta,General]
x-api-key: <clave>            (o  Authorization: Bearer <clave>)

200 → { "firmwares": [ ...releases aprobados... ], "generado": "<ISO>" }
401 → clave ausente o inválida
503 → el servidor no tiene FIRMWARES_API_KEY configurada
```

**Riesgo aceptado:** es la primera ruta pública sin JWT con una credencial
adivinable, y el proyecto no tiene rate limiting en ninguna ruta, así que esta
tampoco lo lleva. Si algún día se agrega un limitador general, esta es la
primera que debería quedar adentro. Mientras tanto, clave larga y aleatoria.

### 2.1 `src/routes/catalogoFirmwares.js` (nuevo)

```js
// Catálogo de firmwares para OTRAS APLICACIONES del ecosistema (Reconecta).
//
// Por qué existe: el módulo AutonomIA de Reconecta necesita leer los releases
// que ingeniería publica acá, pero sin un usuario humano detrás. El único
// camino que había era /api/auth/loginCooptech con un colaborador de servicio,
// y ese JWT abre TODA la API del tablero (CRM, costos, tickets) para leer un
// catálogo de firmwares. Esto es lo mínimo: una API key de solo lectura que
// devuelve únicamente los releases APROBADOS.
//
// Se monta ANTES del middleware `authenticate` (como publicAuthRouter), así que
// no pasa por el login de la app. La credencial es la API key, nada más. No
// tiene rate limit (ninguna ruta del proyecto lo tiene): riesgo asumido, ver
// INTEGRACION_RECONECTA_AUTONOMIA.md §2.
//
// Variable de entorno:
//   FIRMWARES_API_KEY   una clave, o varias separadas por coma (para rotarlas
//                       sin cortar el servicio: se aceptan todas las de la
//                       lista). Sin la variable, el endpoint responde 503 — no
//                       queda abierto por olvido.
//
// Lo que NO sale de acá: los releases sin aprobar (esos solo los ve el área en
// «Gestión de versiones»), el .zip del proyecto Arduino (`fuente`) y quién
// subió cada release (`subidoPor`).
import crypto from 'crypto';
import { Router } from 'express';
import { getConfig } from '../lib/config.js';
import { ApiError } from '../middleware/errorHandler.js';
import { CLAVE_FIRMWARES, PRODUCTOS_FW } from './multivac.js';

export const catalogoFirmwaresRouter = Router();

const clavesValidas = () =>
  String(process.env.FIRMWARES_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

// Comparación de tiempo constante sobre el digest: con === se puede ir
// adivinando la clave midiendo cuánto tarda la respuesta, y comparando los
// buffers crudos habría que cortar antes por longitud (lo que filtra cuánto
// mide la clave). Hasheando, los dos lados miden siempre 32 bytes.
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const coincide = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// La clave viaja en `x-api-key` o como `Authorization: Bearer <clave>`: las dos
// formas son habituales y el cliente usa la que le quede cómoda.
function exigirApiKey(req, res, next) {
  const permitidas = clavesValidas();
  if (!permitidas.length) {
    return next(new ApiError(503, 'not_configured', 'El catálogo externo de firmwares no está habilitado en este servidor'));
  }
  const header = req.headers.authorization || '';
  const clave = req.headers['x-api-key'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!clave || !permitidas.some((k) => coincide(k, clave))) {
    return next(new ApiError(401, 'unauthorized', 'API key inválida o ausente'));
  }
  next();
}

// Proyección explícita: se copia campo por campo lo que el consumidor necesita
// para flashear. Si mañana el manifiesto suma algo interno, no se filtra solo.
const binPublico = (b) =>
  b?.key
    ? {
        key: String(b.key),
        nombre: b.nombre ?? null,
        tamano: b.tamano ?? null,
        sha256: b.sha256 ?? null,
      }
    : null;

const releasePublico = (f) => ({
  modelo: f.modelo,
  chip: f.chip,
  producto: f.producto,
  version: f.version,
  nombre: f.nombre,
  notas: f.notas,
  aprobado: true,
  fecha: f.fecha ?? null,
  flash: f.flash ?? null,
  segmentos: (Array.isArray(f.segmentos) ? f.segmentos : [])
    .map((sg) => ({ ...binPublico(sg), offset: String(sg?.offset || '') }))
    .filter((sg) => sg.key),
  merged: binPublico(f.merged),
});

// GET /api/catalogo/firmwares[?producto=Reconecta,General]
// Respuesta: { firmwares: [...], generado: <ISO> }
catalogoFirmwaresRouter.get('/firmwares', exigirApiKey, async (req, res, next) => {
  try {
    const raw = await getConfig(CLAVE_FIRMWARES);
    let lista = [];
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) lista = p;
      } catch {
        /* config corrupta: catálogo vacío, igual que el GET interno */
      }
    }

    // Filtro opcional por producto. OJO con el encoding: en un query string el
    // `+` se decodifica como espacio, así que «+Agua» se pide como %2BAgua.
    const crudos = String(req.query.producto || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const pedidos = crudos.filter((p) => PRODUCTOS_FW.includes(p));
    // Si pidió filtrar y ningún valor es un producto conocido, la respuesta va
    // vacía. Devolver el catálogo entero sería darle MÁS de lo que pidió, y en
    // silencio (justamente lo que pasaría con un `+Agua` mal encodeado).
    if (crudos.length && !pedidos.length) {
      return res.json({ firmwares: [], generado: new Date().toISOString() });
    }

    const firmwares = lista
      .filter((f) => f?.aprobado === true)
      .filter((f) => !pedidos.length || pedidos.includes(f.producto))
      .map(releasePublico);

    res.json({ firmwares, generado: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});

export default catalogoFirmwaresRouter;
```

### 2.2 `src/app.js`

Junto al import de `publicAuthRouter`:

```js
import { catalogoFirmwaresRouter } from './routes/catalogoFirmwares.js';
```

Y justo **después** de `app.use('/api/auth', publicAuthRouter);` — o sea, antes
de `app.use('/api', authenticate, apiRouter);`:

```js
  // Catálogo de firmwares para otras apps del ecosistema (AutonomIA en
  // Reconecta): API key propia, sin el login del tablero. Va antes de
  // `authenticate` a propósito; ver routes/catalogoFirmwares.js.
  app.use('/api/catalogo', catalogoFirmwaresRouter);
```

### 2.3 `src/routes/multivac.js`

Dos constantes pasan a exportarse (no se mueven ni cambian de valor):

```js
// Exportados: los reusa el catálogo con API key (routes/catalogoFirmwares.js).
export const CLAVE_FIRMWARES = 'multivac_firmwares';
...
export const PRODUCTOS_FW = ['General', '+Agua', 'Reconecta', 'Centinela'];
```

Importar `./multivac.js` por dos constantes arrastra el router entero al archivo
público. No hay ciclo y ese módulo ya se carga por `routes/index.js`, así que es
inocuo; si en algún momento molesta el acoplamiento, las dos constantes se mudan
a un `src/lib/firmwares.js` y los dos routers lo importan de ahí.

### 2.4 `Dockerfile`

Junto a los otros build-args:

```dockerfile
# API key del catálogo de firmwares para Reconecta (AutonomIA). Sin ella el
# endpoint /api/catalogo/firmwares responde 503 y el resto sigue igual.
ARG FIRMWARES_API_KEY
...
ENV FIRMWARES_API_KEY=$FIRMWARES_API_KEY
```

### 2.5 `.github/workflows/cicd.yml`

Una línea más en el `docker build`:

```yaml
                     --build-arg FIRMWARES_API_KEY=${{ secrets.FIRMWARES_API_KEY }} \
```

Hay que cargar el secret `FIRMWARES_API_KEY` en GitHub (Settings → Secrets and
variables → Actions). Si no está, el build no falla: el endpoint queda en 503.

> `Dockerfile` y `cicd.yml` son divergencia **nuestra** respecto de `Leo_back`
> (lo del storage). Estas dos líneas se suman a esa divergencia: cuando llegue
> un drop de Leonardo, no pisarlos.

### 2.6 `CONFIG_INTEGRACIONES.md`

Sección nueva antes de `## Reglas`, con el formato de las secciones 1-3: tabla de
la variable, qué pasa sin ella, qué devuelve y cómo rotar la clave.

---

## 3. Configuración

```
# .env de este repo
FIRMWARES_API_KEY=<clave>
```

Se aceptan varias separadas por coma (`vieja,nueva`) para rotar sin cortarle el
servicio a Reconecta.

Del otro lado, en el `.env` del backend de Reconecta, va:

```
AUTONOMIA_CATALOG_URL=https://tablero.cooptech.com.ar/api/catalogo/firmwares?producto=Reconecta,General
AUTONOMIA_CATALOG_TOKEN=<la misma clave>
```

El `?producto=` es opcional. Los nombres van tal cual figuran en el catálogo
(`General`, `+Agua`, `Reconecta`, `Centinela`) y **url-encodeados**: `+Agua` se
escribe `%2BAgua`, porque un `+` crudo llega al servidor como espacio. Si
ninguno de los pedidos es un producto conocido, la respuesta viene vacía.

---

## 4. Cómo verificar

```bash
# 1) Sin FIRMWARES_API_KEY en el .env — el 503 gana antes que el 401
npm run dev
curl -s localhost:4000/api/catalogo/firmwares
# → 503 {"error":{"code":"not_configured",...}}

# 2) Con FIRMWARES_API_KEY=<clave> en el .env (AUTH_MODE no influye acá)
npm run dev
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/catalogo/firmwares       # 401
curl -s -H "x-api-key: <clave>" localhost:4000/api/catalogo/firmwares | head -c 300   # 200
```

Verificado con stubs de la base durante el diseño (los stubs no quedaron en el
repo; si se reimplementa, conviene rehacer estos casos):

- sin variable → 503; sin clave o clave incorrecta → 401
- clave vieja y nueva conviven (rotación); anda por `x-api-key` y por `Bearer`
- los releases con `aprobado !== true` no salen
- no se filtran `fuente` ni `subidoPor`
- `?producto=` filtra; un producto inexistente devuelve vacío, no el catálogo
- punta a punta contra el `AutonomiaService` de Reconecta: devuelve el release
  con sus segmentos (`offset` + `key`) y el `merged`

---

## 5. Límites: qué NO tocar

- **El flujo de aprobación**: los releases se siguen aprobando en «Gestión de
  versiones». Este endpoint solo lee.
- **`GET /api/multivac/firmwares`** (el interno, que usa el front del tablero):
  queda como está, devolviendo todo, aprobado o no.
- **Nada de exponer releases sin aprobar** por este camino, ni el `.zip` del
  proyecto Arduino: son las dos cosas que justifican que el endpoint recorte
  campo por campo en vez de devolver el manifiesto crudo.
- El catálogo sigue viviendo donde vive: la clave `multivac_firmwares` de la
  tabla `Configuracion` (cifrada, se lee con `getConfig`). No hace falta
  migración ni tabla nueva.

## 6. Contexto extra (por si hace falta)

- Los binarios los baja Reconecta **por su propio backend**, que hace de proxy
  contra `storageov` con las credenciales del servidor. Las llaves del gateway
  son el mismo par en los dos proyectos (`STORAGE_ACCESS`/`STORAGE_SECRET` acá,
  `MINIO_ACCESS`/`MINIO_SECRET` allá); el bucket de los firmwares es `tablero`.
  Este endpoint **no** sirve binarios, solo el manifiesto.
- Por el bug del gateway con `.bin` (nota `storageov-aceptar-bin.md`, que está
  en `~/Documentos/proyectos/`, no en este repo), algunas keys del catálogo
  terminan en `.bin.pdf`. Son firmwares válidos: el endpoint las pasa tal cual y
  del otro lado se sirven como `application/octet-stream`.

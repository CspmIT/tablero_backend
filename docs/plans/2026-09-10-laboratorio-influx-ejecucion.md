# Plan de implementación: Laboratorio — ejecución real del borrado en InfluxDB

Basado en: intent y spec dados de palabra por Agustín en la sesión del 10-sep-2026
(migración de la pantalla `Influx/delete_influx` de la Oficina Virtual). El
módulo Laboratorio de la rama `juan` (28/08) ya tiene el ABM de servidores y la
cola de borrados; dejó explícitamente el hueco de "la ejecución real la conecta
el equipo". Este plan lo completa.
Status: implementado y verificado en dev el 10-sep-2026 (ver "Resultado de la
verificación" al final); pendiente commit y PR.
Fecha: 2026-09-10
Ramas: `feature/laboratorio-influx-ejecucion` desde `origin/juan`, en
`tablero_backend` y `tablero_frontend`.

## Qué hacía la pantalla vieja (fuente de verdad)

1. Bucket (ENERGIA, IOT, EXTERNOS = `IOT-ENERGIA`), fecha/hora de inicio, fecha/hora
   de fin, tópico. Todo obligatorio; fin posterior a inicio.
2. La hora tipeada es hora argentina: el JS le sumaba 180 minutos fijos para
   mandarla en UTC.
3. Back: consulta Flux del tópico en el rango. Sin datos → "No hay datos para
   eliminar". Con datos → DELETE de Influx con predicado `topic="…"`, espera 1 s,
   reconsulta: vacío → "Se eliminó correctamente", si no → "No se pudo eliminar".
4. Tokens y URLs de los tres servidores escritos en el PHP. En el Tablero viven
   en `LabServidor` (URL, token, buckets), cargados desde la pantalla.

## Decisiones (acordadas con Agustín el 10/09)

- Trabajar sobre `juan`, en rama aparte, completando Laboratorio en vez de una
  solapa nueva. Sin variables de entorno nuevas obligatorias ni secrets.
- El borrado se **ejecuta al confirmar** (como la pantalla vieja), y cada
  ejecución queda en `LabBorrado` con su resultado (auditoría que la vieja no tenía).
- Hora **fija de Argentina (UTC-3)**, independiente del navegador y del servidor.
- Tópico escapado en la consulta Flux y en el predicado (el PHP lo concatenaba crudo).
- Chequeo de existencia con `limit(n: 1)` en vez de `aggregateWindow(1m)`: misma
  respuesta sí/no, mucho menos carga en Influx.
- Se respeta el diseño de Juan: servidor MQTT obligatorio en la solicitud, roles
  manager + gerencial + collaborator, contraseñas visibles con el ojito.
- Para servidores Influx, los campos existentes se leen así: `contrasena` = token
  de API, `usuario` = organización (si está vacío, `INFLUX_ORG` o `CoopMorteros`).
  En la pantalla las etiquetas pasan a decir "Organización" y "Token" cuando el
  servidor es Influx. No cambia el esquema.

## Archivos que se van a modificar/crear

### `tablero_backend`

- `src/lib/influx.js` (nuevo) — cliente mínimo de la API v2 de InfluxDB con el
  `fetch` nativo de Node: arma la URL base desde `LabServidor` (esquema, host,
  puerto), `hayDatos()` (query Flux con `limit(n: 1)`), `borrarSerie()`
  (`POST /api/v2/delete`), y `ejecutarBorrado()` que encadena consulta → borrado →
  espera 1 s → reconsulta y devuelve `{ estado, resultado }`. Timeout por
  `INFLUX_TIMEOUT_MS` (default 15000). Errores traducidos a mensajes en castellano.
- `src/routes/laboratorio.js` — `POST /borrados` crea la fila y la ejecuta en el
  momento (exige servidor Influx); nuevo `POST /borrados/:id/ejecutar` para
  reintentar una solicitud `pendiente` o con `error` (incluye las que quedaron
  encoladas antes de este cambio). Estado nuevo `sin_datos`.
- `prisma/schema.prisma` — solo el comentario de `LabBorrado.estado` (se suma
  `sin_datos`). Sin migración: la columna es texto libre.
- `CONFIG_INTEGRACIONES.md` — sección Laboratorio / InfluxDB: dónde se cargan
  los servidores y las dos variables opcionales (`INFLUX_ORG`, `INFLUX_TIMEOUT_MS`).
- `openapi.json` — rutas de `/laboratorio` (hoy no están documentadas).

### `tablero_frontend`

- `src/modules/Laboratorio.jsx` — en `BorradoInflux`: texto y botón pasan de
  "solicitar" a "borrar"; conversión de fechas con `-03:00` fijo y leyenda "Hora
  de Argentina"; aviso de resultado al terminar (borrado, sin datos, error);
  historial con el estado `sin_datos`, el detalle del resultado y botón
  "Ejecutar" / "Reintentar" en pendientes y errores. En `TablaServidores` y
  `ServidorModal`: etiquetas "Organización" / "Token" para servidores Influx.
- `src/api/index.js` — `laboratorio.ejecutarBorrado(id)`.

## Orden de implementación (rebanadas verticales)

1. `src/lib/influx.js` y prueba por script contra el servidor IOT real con un
   tópico inexistente (camino "sin datos") y con un tópico existente solo en
   `hayDatos` (nunca borrar).
2. Rutas: `POST /borrados` ejecutando y `POST /borrados/:id/ejecutar`. Probar
   con `curl` contra el back en dev: sin datos → fila `sin_datos`; servidor
   inaccesible → fila `error` con mensaje legible.
3. Front: `BorradoInflux` con hora argentina, resultado en pantalla, historial y
   reintento. Cargar los tres servidores Influx desde la propia pantalla (ABM de
   Juan) y verificar en el navegador con datos reales.
4. Etiquetas Organización / Token, documentación (`CONFIG_INTEGRACIONES.md`,
   `openapi.json`), comentario del schema.
5. Verificación final (sección de abajo) y PR con `/pr`, back antes que front.

## Tests que van a confirmar cada paso

No hay suite de tests en ninguno de los dos repos; la verificación es manual y
por script, siguiendo `MIGRACION_MODULO_PHP.md` §2.4.

- Paso 1: script Node que llama `hayDatos` contra IOT con tópico inexistente
  (espera `false`) y con `coop/agua/Clientes/AdecoAgro/fosa_entrada/channels`
  en la última hora (espera `true`). `ejecutarBorrado` solo con tópico
  inexistente (espera `sin_datos`).
- Paso 2: `curl` a `POST /api/laboratorio/borrados` con tópico inexistente →
  201 y `estado: 'sin_datos'`; con un servidor con URL inválida → `estado: 'error'`
  y `resultado` legible. Recargar `GET /borrados` y ver que la fila persiste.
- Paso 3: en el navegador, formulario completo → confirmación → aviso "sin
  datos"; historial actualizado; recarga y el registro sigue (skill
  `verificar-persistencia`). Escritorio y 375 px sin desborde. Consola y log del
  back sin errores nuevos.
- Borrado real con datos: **queda sin probar** hasta que Agustín consiga un
  tópico y rango que se puedan borrar. Se documenta en la PR.

## Riesgos / rollback

- **Borrar datos de producción por error**: es la función del módulo. Mitigación:
  confirmación en dos pasos con resumen, verificación previa de existencia,
  auditoría completa en `LabBorrado`, tópico escapado. El DELETE de Influx no
  tiene deshacer: si se borra algo mal, solo se recupera desde un backup del
  servidor Influx.
- **Servidores no alcanzables desde el back**: desde la máquina de Agustín hoy
  responde IOT (`200.63.120.50:18086`); EXTERNOS (`:61086`) y ENERGIA
  (`10.10.115.8:8086`) no. Cada intento queda como `error` con mensaje claro;
  no rompe nada más. Hay que confirmar alcance desde el servidor de producción.
- **Timeouts**: consulta + borrado + reconsulta pueden tardar hasta ~45 s en el
  peor caso (15 s cada paso). El front muestra "Borrando…" y la fila queda con
  el resultado aunque el usuario cierre la pantalla.
- **Rollback**: revertir los commits de la rama. No hay migración ni datos que
  deshacer; las filas de `LabBorrado` con `sin_datos` son compatibles con el
  front viejo (se muestran con el chip por defecto).

## Resultado de la verificación (10-sep-2026, base `tablero_morteros` en 172.26.5.100)

- La base de desarrollo tenía aplicadas todas las migraciones de `juan` menos
  `20260828100000_laboratorio`; se aplicó con `prisma migrate deploy` (solo dos
  `CREATE TABLE`).
- `lib/influx.js` por script contra IOT real: tópico inexistente → `false`;
  tópico real (`coop/agua/Clientes/AdecoAgro/fosa_entrada/channels`, última
  hora) → `true` en ~200 ms; `ejecutarBorrado` con tópico inexistente →
  `sin_datos`; bucket inexistente, token inválido, servidor caído y servidor sin
  token → `InfluxError` con mensaje en castellano.
- Rutas con `curl`: alta de los tres servidores Influx (IOT, EXTERNOS, ENERGIA)
  y un MQTT de prueba; `POST /borrados` tópico inexistente → 201 `sin_datos` en
  0,6 s; contra EXTERNOS (puerto rechaza conexión) → 201 `error` con
  `ECONNREFUSED`; `POST /borrados/2/ejecutar` → 200 `error` de nuevo;
  `POST /borrados/1/ejecutar` (sin_datos) → 400; sin servidor Influx → 400;
  rango invertido → 400. `GET /borrados` devuelve las filas persistidas.
- Pantalla en el navegador (usuario dev = manager): servidores con etiquetas
  Organización/Token; formulario 07:00→08:00 (Argentina) guardado como
  10:00Z→11:00Z; aviso "Sin datos"; historial con hora argentina, detalle del
  resultado y botón Reintentar; la fila sigue tras recargar. A 375 px sin
  desborde horizontal (las tablas scrollean adentro). Consola: solo tres 500 de
  una imagen de perfil en `storageov.cooptech.com.ar`, ajenos al cambio. Log del
  back sin errores.
- **Sin probar**: borrado real con datos (falta un tópico y rango descartables)
  y alcance a EXTERNOS y ENERGIA desde el servidor de producción.
- Quedó cargado en la base de desarrollo el servidor `MQTT (prueba dev)` (id 4)
  y tres filas de historial de prueba; se borran desde la misma pantalla.

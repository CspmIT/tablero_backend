# Configuración de integraciones — Tablero Cooptech

Las integraciones externas del tablero se activan **solo con variables de
entorno** o con datos cargados desde la propia app: sin credenciales, el sistema
funciona igual con su modo degradado. No hay que tocar código ni redesplegar
lógica para encenderlas.

## 1. Asistente IA (Claude)

**Forma recomendada (desde 13/07): cargar la clave desde la app.** El manager,
en la solapa Asistente IA → engranaje → pegar la clave `sk-ant-...` → Guardar.
Al guardar se valida con una llamada real (si Anthropic la rechaza, no se guarda)
y queda **cifrada** en la tabla `Configuracion` (AES-256-GCM derivada de
`AUTH_JWT_SECRET`). Nunca vuelve a mostrarse completa, solo enmascarada.
Cambiar la clave a futuro = repetir esos tres clics; sin tocar el servidor.

| Variable | Valor | Obligatoria |
|---|---|---|
| `ANTHROPIC_API_KEY` | Respaldo opcional por variable de entorno (la clave cargada desde la app tiene prioridad) | No |
| `ASISTENTE_MODEL` | Modelo a usar (default: `claude-sonnet-4-6`) | No |

- **Sin clave (ni en app ni en entorno):** la solapa muestra el aviso "no configurado"; el manager puede cargarla ahí mismo.
- **Ojo:** si se cambia `AUTH_JWT_SECRET`, la clave guardada deja de poder descifrarse → recargarla desde la UI (falla controlada, no rompe nada).

## 2. Videollamadas automáticas (Microsoft Graph)

| Variable | Valor | Obligatoria |
|---|---|---|
| `GRAPH_TENANT_ID` | Id. de directorio (inquilino) de la app "Tablero Cooptech" | Sí, para activar |
| `GRAPH_CLIENT_ID` | Id. de aplicación (cliente) | Sí, para activar |
| `GRAPH_CLIENT_SECRET` | Valor del secreto (¡agendar su fecha de vencimiento!) | Sí, para activar |
| `GRAPH_CASILLA` | Casilla comercial (ej. `comercial@...`) sobre la que se crean los eventos | Sí, para activar |

- **Sin credenciales (o incompletas):** "Agendar videollamada" funciona en modo
  manual asistido: impacto en grilla + actividad + descarga de `.ics` + borrador de mail.
- **Con credenciales:** el mismo botón crea el evento en el Outlook de la casilla
  comercial con reunión de Teams; Exchange envía las invitaciones (bloque estándar
  "Unirse / Id. de reunión / Código de acceso") al cliente y a los colaboradores.
  El link de Teams queda guardado en el ítem de la grilla y en la actividad del CRM.
- **Si Graph falla en el momento** (secreto vencido, permiso revocado, corte):
  el impacto interno se hace igual y la UI ofrece el `.ics` con un aviso del error.
  La videollamada nunca queda sin camino.

## 3. Laboratorio: borrado de datos en InfluxDB (10/09/2026)

Los servidores InfluxDB **no van en variables de entorno**: se cargan desde la
solapa Laboratorio → InfluxDB → Agregar (URL, organización, token de API y la
lista de buckets). Quedan en la tabla `LabServidor`. El token se escribe una
vez y **no vuelve a mostrarse ni viaja al front**: la API solo informa si está
cargado; para cambiarlo se pega uno nuevo al editar (vacío conserva el actual).
Las contraseñas de los servidores MQTT sí se ven con el ojito (decisión 28/08,
herramienta interna). Cada borrado se ejecuta al confirmar contra ese servidor
(`src/lib/influx.js`: consulta → delete → reconsulta) y queda registrado en
`LabBorrado` con quién, cuándo, rango, tópico y resultado.

| Variable | Valor | Obligatoria |
|---|---|---|
| `INFLUX_ORG` | Organización por defecto cuando el servidor no tiene cargada la suya (default: `CoopMorteros`) | No |
| `INFLUX_TIMEOUT_MS` | Tiempo máximo por llamada a Influx, en milisegundos (default: `15000`) | No |

- **Sin servidores cargados:** la pantalla lo dice y el formulario no deja borrar.
- **Servidor caído, token rechazado o bucket inexistente:** la solicitud queda en
  estado `error` con el motivo en castellano y un botón «Reintentar».
- El token necesita permiso de **lectura y escritura** sobre el bucket (el delete
  de Influx es una operación de escritura). El servidor de producción debe llegar
  a las URLs cargadas: hoy IOT (`200.63.120.50:18086`) responde desde la red de
  la cooperativa; ENERGIA (`10.10.115.8:8086`) es una IP interna.
- Migrado de `Influx/delete_influx` de la Oficina Virtual, donde los tokens
  estaban escritos en el PHP. Conviene rotarlos en Influx y recargarlos acá.

## Reglas

- Credenciales **solo** en variables de entorno del servidor o cargadas desde la
  app (cifradas o restringidas por rol). Nunca en el repo.
- Ante sospecha de filtración: revocar/regenerar (consola de Anthropic / Entra ID)
  y actualizar las variables. No hay nada más que tocar.
- El secreto de Graph vence (24 meses recomendados): registrar la fecha y renovarlo antes.

*Generado 08/07/2026 · acompaña a `Guia_admin_M365_Graph_y_Claude_API_07_07.md` (trámites del administrador).*

# Configuración de integraciones — Tablero Cooptech

Las dos integraciones externas del tablero se activan **solo con variables de
entorno**: sin credenciales cargadas, el sistema funciona igual con su modo
degradado. No hay que tocar código ni redesplegar lógica para encenderlas.

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

## Reglas

- Credenciales **solo** en variables de entorno del servidor. Nunca en el repo.
- Ante sospecha de filtración: revocar/regenerar (consola de Anthropic / Entra ID)
  y actualizar las variables. No hay nada más que tocar.
- El secreto de Graph vence (24 meses recomendados): registrar la fecha y renovarlo antes.

*Generado 08/07/2026 · acompaña a `Guia_admin_M365_Graph_y_Claude_API_07_07.md` (trámites del administrador).*

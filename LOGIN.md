# Sistema de Login / Autenticación — Reconecta

Documentación del flujo de autenticación de Reconecta, pensada para replicar el
mismo esquema en otro proyecto similar (apps del ecosistema Cooptech).

> ⚠️ Los secretos (JWT secret, tokens, credenciales de BD) que aparecen abajo
> están como **placeholders**. No copiar valores reales entre proyectos.

---

## 1. Visión general

Es un esquema de autenticación **híbrido y centralizado** con dos backends:

- **Cooptech** (backend externo/centralizado): valida email + contraseña del
  usuario y devuelve los clientes/organizaciones a los que tiene acceso.
- **Reconecta** (backend local de la app): no maneja contraseñas; recibe un
  `tokenApp` único por usuario y emite el **JWT final** que usa la app.

Características:

- **Multi-tenancy por schema SQL**: cada organización (cliente) tiene su propia
  base de datos con el mismo esquema de tablas. El tenant viaja dentro del JWT.
- **Sin contraseñas en Reconecta**: la credencial es un `token_app` (UUID) único
  por usuario, asignado por Cooptech.
- **Almacenamiento dual en el cliente**: `localStorage` (datos) + cookies / store
  de Tauri (token con expiración).

```
┌──────────┐   email+pass    ┌──────────────┐
│ Frontend │ ──────────────▶ │   Cooptech   │  (login centralizado)
│ (Electron│ ◀────────────── │   /api/login │
│  /React) │   token+clientes└──────────────┘
│          │
│          │   email+tokenApp+schemaName    ┌────────────┐
│          │ ─────────────────────────────▶ │  Reconecta │  (JWT final)
│          │ ◀───────────────────────────── │/loginCooptech│
└──────────┘            JWT                  └────────────┘
```

---

## 2. Backend — Reconecta (Node / Express)

### 2.1 Endpoints de auth

Archivo: `routes/Auth.routes.js`

| Endpoint                       | Método | Controlador            | Auth   | Descripción                              |
|--------------------------------|--------|------------------------|--------|------------------------------------------|
| `/api/loginCooptech`           | POST   | `loginCooptech`        | pública| Login de usuarios internos               |
| `/api/generateTokenCooptech`   | POST   | `loginCooptechExternal`| pública| Token para usuarios externos de Cooptech |
| `/api/relationUserCooptech`    | POST   | `relationUserCooptech` | pública| Vincula/crea usuario desde Cooptech      |

> No hay endpoints de **logout**, **refresh token** ni **recuperación de
> contraseña** en Reconecta. La recuperación se hace contra Cooptech.

### 2.2 Controladores

Archivo: `controllers/Cooptech.controller.js`

**`loginCooptech()`** — recibe `{ email, tokenApp, schemaName, influx_name }` y:

1. Busca el usuario por `email` en la BD del schema indicado.
2. Valida `user.status == 1` (activo).
3. Valida que `user.token_app === tokenApp`.
4. Devuelve `{ token: "<JWT>" }`.

**`loginCooptechExternal()`** — igual, más `{ cliente, id_user, tokenCooptech }`
para usuarios externos.

**`relationUserCooptech()`** — crea/actualiza el usuario en el tenant a partir de
`{ name, last_name, dni, email, token, profile, schema_name }`.

### 2.3 Generación / validación de JWT

Archivo: `services/AuthService.js` — usa `jsonwebtoken` (v9).

- **Secret**: `process.env.SECRET`
- **Expiración**: 8 horas

Payload de `signTokenCooptech()`:

```js
{
  iss: `app-${schemaName}`,   // identifica el tenant
  nameApp: schemaName,
  sub: user.id,               // ID del usuario
  iat: <now>,
  exp: <now + 8h>,
  name: user.first_name,
  lastName: user.last_name,
  profile: user.profile,
  dark: user.dark,
  email: user.email,
  token: tokenApp,
  influx_name: influx_name,
  img_profile: user.img_profile
}
```

`signTokenCooptechExternal()` agrega `{ cliente, user_id_cooptech, tokenCooptech }`.

### 2.4 Middleware

Archivo: `middleware/Auth.middleware.js`

**`verifyToken()`** (rutas protegidas):

1. Lee token de `req.cookies.token` o header `Authorization: Bearer <token>`.
2. `jwt.verify(token, SECRET)`.
3. Extrae el schema del claim `iss` (quita el prefijo `app-`).
4. Carga la BD del tenant correspondiente.
5. Valida que el usuario siga existiendo y activo.
6. Setea `req.user = { id, influx_name, name_coop }`.
7. Responde `400` si falta/inválido/usuario inexistente.

**`alarmToken()`** — para endpoints de alarmas de InfluxDB; compara contra
`process.env.ALARM_TOKEN`.

### 2.5 Modelo de usuario

Archivo: `models/user.js` — tabla `Users`:

| Campo        | Tipo    | Notas                                      |
|--------------|---------|--------------------------------------------|
| `id`         | INTEGER | PK, autoincrement                          |
| `first_name` | STRING  |                                            |
| `last_name`  | STRING  |                                            |
| `email`      | STRING  | usado para login                           |
| `profile`    | TINYINT | id de perfil/rol                           |
| `status`     | BOOLEAN | 1 = activo                                 |
| `dark`       | BOOLEAN | preferencia de tema                        |
| `token_app`  | STRING  | **credencial de login** (UUID, no hasheado)|
| `img_profile`| STRING  | URL imagen perfil                          |

> No se usan contraseñas hasheadas para usuarios. `bcrypt` está disponible pero
> sólo se usa (si acaso) para credenciales de dispositivos (`RecloserPassword`),
> no para el login de usuarios.

### 2.6 Variables de entorno (backend)

```env
SECRET='<jwt-secret>'          # firma/verificación de JWT
ALARM_TOKEN='<token-alarmas>'  # endpoints de alarmas InfluxDB

DB_HOST=<host>
DB_USER=<user>
DB_PASS='<pass>'
DB_NAME=<schema-por-defecto>   # ej: reconecta_desarrollo
```

---

## 3. Frontend — Reconecta Desktop (Electron + React + Vite)

### 3.1 Vista de login

Archivo: `src/modules/LoginApp/view/index.jsx` (usa `react-hook-form`).

**Campos del formulario:**

- **Email** — requerido, pattern `^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$`.
- **Contraseña** — requerida, mínimo 8 caracteres, pattern `^(?=.*[A-Z]).{8,}$`
  (al menos una mayúscula). Botón de mostrar/ocultar.
- **"Olvidé mi contraseña"** — toggle que oculta la contraseña, cambia el endpoint
  a `/password_recover` y sólo envía el email.

Al montar, si ya hay token en cookies y usuario en `localStorage`, redirige a `/`.

### 3.2 Llamadas al backend

Archivo: `src/modules/LoginApp/utils/requesLogin.js`

- `requestLogin(url, method, data)` — POST sin auth (login / recuperación).
- `requestAuth(url, method, data)` — agrega `Authorization: Bearer <token>` leído
  de `storage.get('usuarioCooptech').token`.

Endpoints involucrados:

| Endpoint                                   | Backend   | Uso                              |
|--------------------------------------------|-----------|----------------------------------|
| `POST /login`                              | Cooptech  | login (email + password)         |
| `POST /password_recover`                   | Cooptech  | recuperación de contraseña       |
| `GET  /getUser?id=`                        | Cooptech  | datos del usuario                |
| `POST /loginCooptech`                      | Reconecta | emite JWT final                  |
| `GET  /getSchemaProduct?clientId&productId`| Cooptech  | schema del producto/tenant       |
| `GET  /listProductxUserxClient?...`        | Cooptech  | productos del usuario por cliente |
| `GET  /listClientsxUserxApp?...`           | Cooptech  | organizaciones del usuario       |

### 3.3 Configuración de URLs (por ambiente)

Archivo: `src/utils/routes/app.routes.js`

```js
export const front = {
  Cooptech:  VITE_ENTORNO == 'local' ? 'https://dev.cooptech.com.ar' : 'https://cooptech.com.ar',
  Reconecta: VITE_ENTORNO == 'local' ? 'http://localhost:4000'       : 'https://reconecta.cooptech.com.ar',
}
export const backend = {
  Cooptech:  `${front.Cooptech}/api`,
  Reconecta: `${front.Reconecta}/api`,
}
```

Variables (`.env`): `VITE_APP_NAME`, `VITE_ENTORNO` (`local` / prod), `VITE_MINIO_*`.

### 3.4 Almacenamiento de sesión

Dos mecanismos:

- **`localStorage`** (`src/modules/LoginApp/utils/storage.js`) — wrapper JSON:
  `get/set/remove/clear`. Guarda `usuario`, `usuarioCooptech`, `tokenCooptech`.
- **Cookies / Tauri store** (`src/storage/cookies-store.js`) — detecta Electron
  (Tauri) y usa `@tauri-apps/plugin-store` (`store.json`), o `js-cookie` en web.
  Funciones: `saveData`, `getData`, `removeData`. Guarda el `token` con fecha de
  expiración tomada del JWT (`jwtDecode(token).exp`).

### 3.5 Rutas y protección

Archivo: `src/App.jsx` — separa `loginRoutes` (públicas: `/login`, `/ListClients`,
`/LoginCooptech/:token`) de `userRoutes` (protegidas, envueltas en `MainContent`).

`src/modules/core/views/index.jsx` → `validationUser()` se ejecuta en cada cambio
de ruta:

1. Lee `token` de `getData('token')`.
2. Si no hay usuario o token → `localStorage.clear()`, `removeData('token')`,
   `navigate('/login')`.
3. Verifica permisos por ruta (`userPermisos` por `path` + `status`); si no tiene
   acceso, redirige a `/Home` con aviso.

### 3.6 Logout y cambio de organización

Archivo: `src/modules/core/components/DropdownImage/index.jsx`

- **`handleLogout()`** — `localStorage.clear()`, resetea contexto, `removeData('token')`,
  `navigate('/')`.
- **`handleChangeClient()`** — borra sólo `usuario`, `removeData('token')`,
  `navigate('/ListClients/1')`.

### 3.7 Vistas auxiliares

- **`ListClient.jsx`** — selector de organización cuando el usuario tiene varias;
  al elegir navega a `/LoginCooptech/{token}`.
- **`LoginCooptech.jsx`** — componente sin UI: decodifica el JWT del param de la
  URL, lo guarda en `localStorage` + cookie/store y redirige a `/`. Si el token
  es inválido, limpia y vuelve a `/login`.

---

## 4. Flujo completo paso a paso

```
1.  Usuario entra a /login.
2.  Completa email + password.
3.  POST /login (Cooptech)  →  { token, id, cliente: [...] }.
4.  Guarda en localStorage: usuario, usuarioCooptech, tokenCooptech.
5.  ¿Varios clientes?
      Sí → /ListClients (elige organización).
      No → continúa directo.
6.  POST /loginCooptech (Reconecta) con { email, tokenApp, schemaName, influx_name }.
7.  Respuesta: { token } (JWT con datos de usuario + tenant, exp 8h).
8.  Navega a /LoginCooptech/{token}.
9.  Decodifica el JWT, guarda token en localStorage + cookie/store (con exp).
10. Redirige a / (Home, protegida).
11. MainContent valida token + usuario en cada ruta; si falla → /login.
```

---

## 5. Limitaciones / a tener en cuenta al replicar

- **Sin logout real en backend**: el JWT vive 8 h y no se puede revocar antes.
- **Sin refresh token**: al expirar, el usuario vuelve a loguearse.
- **`token_app` en texto plano** en la BD (no hasheado).
- **Recuperación de contraseña** vive en Cooptech, no en la app local.
- El claim `iss` define el tenant: cuidar su validación al cargar la BD.
- Considerar mover secretos fuera del repo y rotar `ALARM_TOKEN` / `SECRET`.

---

## 6. Mapa de archivos clave

**Backend (`back-reconecta`):**

| Archivo                                  | Rol                                  |
|------------------------------------------|--------------------------------------|
| `routes/Auth.routes.js`                  | endpoints de auth                    |
| `controllers/Cooptech.controller.js`     | lógica de login                      |
| `services/AuthService.js`                | firma/verificación de JWT            |
| `middleware/Auth.middleware.js`          | `verifyToken`, `alarmToken`          |
| `models/user.js`                         | modelo de usuario                    |
| `.env`                                   | `SECRET`, `ALARM_TOKEN`, `DB_*`      |

**Frontend (`reconecta-desktop`):**

| Archivo                                          | Rol                              |
|--------------------------------------------------|----------------------------------|
| `src/modules/LoginApp/view/index.jsx`            | formulario de login              |
| `src/modules/LoginApp/utils/requesLogin.js`      | requests al backend              |
| `src/modules/LoginApp/utils/login.js`            | flujo multi-cliente, `saveDataUser` |
| `src/modules/LoginApp/utils/storage.js`          | wrapper de localStorage          |
| `src/storage/cookies-store.js`                   | cookies / Tauri store            |
| `src/utils/routes/app.routes.js`                 | URLs por ambiente                |
| `src/App.jsx`                                    | rutas públicas vs protegidas     |
| `src/modules/core/views/index.jsx`               | `validationUser` (protección)    |
| `src/modules/core/components/DropdownImage/index.jsx` | logout / cambio de organización |
| `src/modules/LoginApp/view/ListClient.jsx`       | selector de organización         |
| `src/modules/LoginApp/view/LoginCooptech.jsx`    | guarda JWT final                 |

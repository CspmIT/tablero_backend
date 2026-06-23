# Backend — Tablero de Mando Cooptech

API REST del Tablero Cooptech. Hecha con Node + Express + Prisma + MySQL.
Pensada para correr primero en tu máquina y luego en producción.

## Qué necesitás instalar (una sola vez)

1. **Node.js 20 o superior** — https://nodejs.org (elegí la versión "LTS").
2. **Docker Desktop** — https://www.docker.com/products/docker-desktop
   (lo usamos para levantar la base de datos y el almacenamiento de archivos sin instalarlos a mano).

## Cómo levantarlo (paso a paso)

Abrí una terminal dentro de esta carpeta y ejecutá, en orden:

```bash
# 1. Copiá el archivo de configuración de ejemplo
cp .env.example .env

# 2. Levantá la base de datos (MySQL) y el almacenamiento (MinIO)
docker compose up -d

# 3. Instalá las dependencias del proyecto
npm install

# 4. Creá las tablas en la base de datos
npm run prisma:migrate

# 5. Cargá los datos iniciales (tu usuario y algunas etiquetas)
npm run db:seed

# 6. Arrancá el servidor
npm run dev
```

Listo. Vas a ver un mensaje con las direcciones. Abrí en el navegador:

- **http://localhost:4000/api-docs** — la documentación interactiva (probá los endpoints desde ahí).
- **http://localhost:4000/health** — para confirmar que está vivo (debe decir `{"ok":true}`).

## Cosas útiles

- **Ver/editar la base con una interfaz visual:** `npm run prisma:studio` (abre una pantalla web para mirar las tablas).
- **MinIO (archivos):** consola en http://localhost:9001 (usuario `cooptech`, clave `cooptech123`).
- **Apagar todo:** `docker compose down` (los datos quedan guardados). Para borrar también los datos: `docker compose down -v`.

## Sobre el login (importante)

Por ahora el backend está en **modo desarrollo** (`AUTH_MODE=dev` en el `.env`):
no hace falta token, y todas las llamadas se atribuyen al colaborador con id 1 (vos).
Cuando tengamos las especificaciones del servicio de identidad real, cambiamos a
`AUTH_MODE=prod` y el backend pasa a validar el token de verdad. No hay que reescribir nada más.

## Estructura

- `prisma/schema.prisma` — el modelo de datos (las tablas).
- `openapi.yaml` / `openapi.json` — el contrato de la API (lo que sirve `/api-docs`).
- `src/` — el código del servidor:
  - `routes/` — los endpoints por recurso.
  - `middleware/` — autenticación y manejo de errores.
  - `lib/` — conexión a la base, a MinIO y el generador de CRUD.

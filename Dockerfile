FROM node:20.15.0-alpine3.20
WORKDIR /usr/src/app

# Build-args que pasa el workflow (cargá estos secrets en GitHub).
ARG DATABASE_URL
ARG AUTH_JWT_SECRET
# Credenciales del gateway de almacenamiento (storageov → MinIO): son las MISMAS
# que ya usa el frontend, así que en el workflow salen de los secrets
# MINIO_ACCESS / MINIO_SECRET que ya existen. Sin ellas la app funciona igual,
# pero al borrar una referencia el binario queda huérfano en MinIO (queda el
# aviso en el log; ver src/lib/almacenamiento.js).
ARG STORAGE_ACCESS
ARG STORAGE_SECRET

# Variables que usa la app: Prisma lee DATABASE_URL; el auth valida el JWT con
# AUTH_JWT_SECRET cuando AUTH_MODE=prod. AUTH_MODE y PORT son config (no secrets).
ENV DATABASE_URL=$DATABASE_URL
ENV AUTH_JWT_SECRET=$AUTH_JWT_SECRET
ENV AUTH_MODE=prod
ENV PORT=4000
# Almacenamiento: la URL y el bucket no son secretos, van fijos acá (son los
# mismos valores que VITE_MINIO_URL / VITE_MINIO_BUCKET del frontend).
ENV STORAGE_URL=https://storageov.cooptech.com.ar
ENV STORAGE_BUCKET=tablero
ENV STORAGE_ACCESS=$STORAGE_ACCESS
ENV STORAGE_SECRET=$STORAGE_SECRET

COPY package*.json ./
RUN npm install

COPY . .

# Genera el Prisma Client (no necesita conexión a la BD).
RUN npx prisma generate

EXPOSE 4000
# Las migraciones se aplican aparte (npx prisma migrate deploy); ver README.
CMD ["node", "src/server.js"]

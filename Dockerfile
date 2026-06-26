FROM node:20.15.0-alpine3.20
WORKDIR /usr/src/app

# Build-args que pasa el workflow (cargá estos secrets en GitHub).
ARG DATABASE_URL
ARG AUTH_JWT_SECRET

# Variables que usa la app: Prisma lee DATABASE_URL; el auth valida el JWT con
# AUTH_JWT_SECRET cuando AUTH_MODE=prod. AUTH_MODE y PORT son config (no secrets).
ENV DATABASE_URL=$DATABASE_URL
ENV AUTH_JWT_SECRET=$AUTH_JWT_SECRET
ENV AUTH_MODE=prod
ENV PORT=4000

COPY package*.json ./
RUN npm install

COPY . .

# Genera el Prisma Client (no necesita conexión a la BD).
RUN npx prisma generate

EXPOSE 4000
# Las migraciones se aplican aparte (npx prisma migrate deploy); ver README.
CMD ["node", "src/server.js"]

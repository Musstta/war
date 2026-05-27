FROM node:22-alpine

# Prisma schema engine requires OpenSSL at runtime on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

# Copy workspace manifests + root tsconfig so npm install can resolve all workspaces
COPY package.json tsconfig.json ./
COPY engine/package.json ./engine/
COPY server/package.json ./server/
COPY web/package.json ./web/

# Copy Prisma schema before npm install so prisma generate can run
COPY server/prisma ./server/prisma/

RUN npm install

# Generate Prisma client (schema was copied above; client goes into node_modules)
RUN cd server && npx prisma generate --schema=prisma/schema.prisma

# Copy source (docker-compose bind-mounts ./server/src at runtime for hot-reload)
COPY engine/ ./engine/
COPY data/ ./data/
COPY server/ ./server/

WORKDIR /app/server

# Run pending migrations then start the server.
# prisma migrate deploy is idempotent — safe to run on every container start.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && ../node_modules/.bin/tsx watch src/index.ts"]

FROM node:22-alpine

WORKDIR /app

# Copy workspace manifests so npm install can resolve all workspaces
COPY package.json tsconfig.json ./
COPY engine/package.json ./engine/
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm install

# Copy source (docker-compose bind-mounts ./web/src and index.html at runtime for hot-reload)
COPY web/ ./web/

WORKDIR /app/web
CMD ["../node_modules/.bin/vite"]

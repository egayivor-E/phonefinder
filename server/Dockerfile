# PhoneFinder server — multi-stage build
# Build context MUST be the phonefinder/ project root (so both server/ and
# dashboard/ are available). Use docker compose, or:
#   docker build -f server/Dockerfile -t phonefinder .

# ---- build stage: compile the better-sqlite3 native module ----
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime stage: minimal image, no compilers ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/phonefinder.db
WORKDIR /app
COPY --from=build /app/server/node_modules ./server/node_modules
COPY server/package.json server/server.js ./server/
COPY dashboard ./dashboard

# SQLite database lives on a mounted volume (see docker-compose.yml)
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]

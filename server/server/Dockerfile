# PhoneFinder server — PostgreSQL backend (pure-JS deps, no compilers needed)
# Build context MUST be the phonefinder/ project root:
#   docker build -f server/Dockerfile -t phonefinder .

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/server.js server/db.js ./server/
COPY dashboard ./dashboard
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]

FROM oven/bun:1.4.4-alpine AS build

ARG NPM_CONFIG_REGISTRY

WORKDIR /workspace

COPY package.json ./
COPY packages/js/client/package.json packages/js/client/package.json
COPY packages/js/static-server/package.json packages/js/static-server/package.json
COPY packages/js/web/package.json packages/js/web/package.json
RUN bun install --no-save

COPY tsconfig.json ./
COPY packages/js/client packages/js/client
COPY packages/js/static-server packages/js/static-server
COPY packages/js/web packages/js/web
COPY packages/py/core packages/py/core
COPY packages/py/server packages/py/server

RUN mkdir -p packages/js/web/catalog \
    && bun run build:client \
    && DBX_MODEL_CATALOG_WEB_SOURCE=github bun run build:web \
    && rm -rf \
      packages/js/web/dist/catalog \
      packages/js/web/dist/catalog.json \
      packages/js/web/dist/catalog.sqlite \
      packages/js/web/dist/search-index.json \
    && test ! -e packages/js/web/dist/catalog \
    && test ! -e packages/js/web/dist/catalog.json \
    && test ! -e packages/js/web/dist/catalog.sqlite \
    && test ! -e packages/js/web/dist/search-index.json

FROM oven/bun:1.4.4-alpine

ARG NPM_CONFIG_REGISTRY

LABEL org.opencontainers.image.source="https://github.com/reggie-db/dbx-model-catalog"

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY packages/js/static-server/package.json packages/js/static-server/package.json
RUN bun install --production --no-save

COPY --from=build --chown=bun:bun /workspace/packages/js/static-server/src packages/js/static-server/src
COPY --from=build --chown=bun:bun /workspace/packages/js/web/dist public

RUN test ! -e public/catalog \
    && test ! -e public/catalog.json \
    && test ! -e public/catalog.sqlite \
    && test ! -e public/search-index.json

USER bun

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const response = await fetch('http://127.0.0.1:8080/healthz'); if (!response.ok) process.exit(1)"

CMD ["bun", "packages/js/static-server/src/server.ts"]

FROM oven/bun:1.4.4-alpine AS build

WORKDIR /workspace

COPY package.json ./
COPY packages/js/client/package.json packages/js/client/package.json
COPY packages/js/web/package.json packages/js/web/package.json
RUN bun install --no-save

COPY tsconfig.json ./
COPY packages/js/client packages/js/client
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

FROM nginxinc/nginx-unprivileged:1.29.3-alpine

LABEL org.opencontainers.image.source="https://github.com/reggie-db/dbx-model-catalog"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /workspace/packages/js/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

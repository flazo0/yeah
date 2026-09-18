# Single Dockerfile, multiple targets — one image layer cache shared by api/worker/ws, so a
# `docker compose build` only recompiles what actually changed instead of doing this 4x.

# Pinned exact (not the floating "1-alpine" tag) — 1.4.x broke vue-tsc's .vue module
# resolution silently (every .vue import became a TS2307 "module not found" even though
# the files and deps were all present); 1.3.14 is what local dev actually uses and verified working.
FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app
# Baked in at build time so the running API can report "you're N commits behind" — the image has
# no .git directory (only specific paths get COPY'd below), so this is the only way it knows.
ARG YEAH_COMMIT=dev
ENV YEAH_COMMIT=${YEAH_COMMIT}
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/ws/package.json ./apps/ws/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM base AS api
COPY apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]

# ---------------------------------------------------------------------------
FROM base AS worker
COPY apps/worker ./apps/worker
WORKDIR /app/apps/worker
CMD ["bun", "run", "src/index.ts"]

# ---------------------------------------------------------------------------
FROM base AS ws
COPY apps/ws ./apps/ws
WORKDIR /app/apps/ws
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]

# ---------------------------------------------------------------------------
FROM base AS web-build
COPY apps/web ./apps/web
WORKDIR /app/apps/web
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_BASE_PATH
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
# `bun run build` (Bun's own JS engine executing vue-tsc) silently fails to recognize .vue files
# as modules on Linux — every single .vue import becomes "cannot find module", confirmed by
# A/B-testing real Node.js vs Bun against the identical installed node_modules on this exact
# image (works fine on Windows, where Bun happens to dispatch to real node.exe instead).
# Invoking the .bin scripts directly lets the OS honor their "#!/usr/bin/env node" shebang.
RUN apk add --no-cache nodejs && ./node_modules/.bin/vue-tsc -b && ./node_modules/.bin/vite build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
# nginx's own entrypoint envsubst's *.template -> conf.d/*.conf at container start using only
# real container env vars (PANEL_PATH here — see docker-compose.prod.yml) — nginx's own runtime
# variables ($host, $uri, etc.) are untouched since they aren't actual env vars, just $-prefixed
# nginx syntax. This lets the panel path change on restart without rebuilding the image.
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80

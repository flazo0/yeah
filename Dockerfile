# Single Dockerfile, multiple targets — one image layer cache shared by api/worker/ws, so a
# `docker compose build` only recompiles what actually changed instead of doing this 4x.

FROM oven/bun:1-alpine AS base
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
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
RUN bun run build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

#!/bin/sh
# Runs as part of nginx's own /docker-entrypoint.d/ startup hooks (see Dockerfile). PANEL_PATH
# is opt-in (empty by default — see install.sh/docker-compose.prod.yml): if it's unset, this does
# nothing and nginx just uses the plain nginx.conf baked into the image at build time. If it's
# set, it rewrites conf.d/default.conf to only answer under that prefix, closing the connection
# (no HTTP response at all) on everything else — see docs/ARCHITECTURE.md for why.
set -eu

PREFIX="${PANEL_PATH:-}"
[ -z "$PREFIX" ] && exit 0

# Normalize to "/something" — no trailing slash, exactly one leading slash.
PREFIX="/${PREFIX#/}"
PREFIX="${PREFIX%/}"
[ "$PREFIX" = "/" ] && exit 0

cat > /etc/nginx/conf.d/default.conf <<EOF
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    include /etc/nginx/realip.inc;

    location = ${PREFIX} {
        return 301 ${PREFIX}/;
    }

    location ${PREFIX}/api/ {
        proxy_pass http://api:3000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ${PREFIX}/ws {
        proxy_pass http://ws:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 1h;
    }

    location ${PREFIX}/assets/ {
        alias /usr/share/nginx/html/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location ${PREFIX}/ {
        alias /usr/share/nginx/html/;
        try_files \$uri \$uri/ ${PREFIX}/index.html;
        index index.html;
    }

    location / {
        return 444;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
EOF

#!/bin/sh
# Behind a Cloudflare Tunnel every request reaches nginx from the cloudflared container, so
# $remote_addr is always that container's IP — which would make the API's per-IP rate limiter treat
# all visitors as one client. With TRUST_CF_CONNECTING_IP=1 the real visitor IP is taken from the
# CF-Connecting-IP header, but only for connections from private (Docker network) addresses: a
# client hitting the exposed port directly comes from a public IP and can't spoof it.
set -eu

[ "${TRUST_CF_CONNECTING_IP:-}" = "1" ] || exit 0

cat > /etc/nginx/realip.inc <<'CONF'
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
real_ip_header CF-Connecting-IP;
CONF

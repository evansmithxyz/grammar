#!/usr/bin/env bash
# Sets up a Debian or Ubuntu server for Sentence Diagrammer: Caddy for the site,
# and the spaCy parse server as a systemd service. Runs as root on the server;
# scripts/deploy.sh uploads it and runs it when given --setup. Safe to run again.
#
#   MODEL   en_core_web_trf (accurate, needs ~2 GB of memory) or en_core_web_sm
#           (small and fast). Default: trf with 4 GB of memory or more, else sm.
#   DOMAIN  a name pointed at this server, for HTTPS. Default: plain HTTP on port 80.
set -euo pipefail

APP=/opt/sentence-grapher
ENV_FILE=/etc/sentence-grapher.env

# settings from an earlier run stay unless given again
want_model=${MODEL:-} want_domain=${DOMAIN:-}
SPACY_MODEL='' DOMAIN=''
if [ -f "$ENV_FILE" ]; then . "$ENV_FILE"; fi
MODEL=${want_model:-$SPACY_MODEL}
DOMAIN=${want_domain:-$DOMAIN}
mem_gb=$(awk '/MemTotal/ { printf "%d", $2 / 1024 / 1024 + 0.5 }' /proc/meminfo)
if [ -z "$MODEL" ]; then
  if [ "$mem_gb" -ge 4 ]; then MODEL=en_core_web_trf; else MODEL=en_core_web_sm; fi
fi
echo "== Sentence Diagrammer setup: $mem_gb GB of memory, model $MODEL, ${DOMAIN:-no domain (HTTP on port 80)}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3-venv python3-pip curl gnupg
if ! command -v caddy >/dev/null; then
  if apt-cache show caddy >/dev/null 2>&1; then
    apt-get install -y -q caddy
  else
    # older releases (Ubuntu 22.04) don't package Caddy: use Caddy's own repository
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy
  fi
fi

echo "== Python packages"
[ -x "$APP/.venv/bin/python" ] || python3 -m venv "$APP/.venv"
# exact versions known to work, for every install below (spacy download included)
export PIP_CONSTRAINT="$APP/server/constraints.txt"
pip="$APP/.venv/bin/pip"
"$pip" install -q --upgrade pip
if [ "$MODEL" = en_core_web_trf ]; then
  # CPU-only PyTorch: the default wheels bring gigabytes of GPU libraries this server can't use.
  # An extra index (not the only one), so torch's own dependencies still come from PyPI at the
  # pinned versions; "2.14.1+cpu" ranks above plain "2.14.1", so the CPU build wins.
  cpu=https://download.pytorch.org/whl/cpu
  "$pip" install -q torch --extra-index-url "$cpu"
  "$pip" install -q -r "$APP/server/requirements.txt" --extra-index-url "$cpu"
else
  "$pip" install -q 'spacy>=3.8,<3.9' fastapi 'uvicorn[standard]'
fi
"$APP/.venv/bin/python" -m spacy info "$MODEL" >/dev/null 2>&1 || "$APP/.venv/bin/python" -m spacy download "$MODEL"

echo "== Services"
printf 'SPACY_MODEL=%s\nDOMAIN=%s\n' "$MODEL" "$DOMAIN" > "$ENV_FILE"
install -m 644 "$APP/deploy/sentence-grapher-parser.service" /etc/systemd/system/
mkdir -p /srv/sentence-grapher
if [ -n "$DOMAIN" ]; then
  sed "s/^:80 {/$DOMAIN {/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
  # www.<domain>, if it has a DNS record, sends visitors to the plain address
  if [ "${DOMAIN#www.}" = "$DOMAIN" ] && getent hosts "www.$DOMAIN" >/dev/null; then
    printf '\nwww.%s {\n\tredir https://%s{uri} permanent\n}\n' "$DOMAIN" "$DOMAIN" >> /etc/caddy/Caddyfile
  fi
else
  install -m 644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable -q caddy sentence-grapher-parser
systemctl restart sentence-grapher-parser
systemctl reload caddy || systemctl restart caddy

echo "== Waiting for the parse server to load $MODEL"
for _ in $(seq 1 90); do
  if curl -fs http://127.0.0.1:8000/health >/dev/null; then echo "== Parse server is up"; exit 0; fi
  sleep 2
done
echo "!! The parse server didn't answer within 3 minutes. See: journalctl -u sentence-grapher-parser -n 50" >&2
exit 1

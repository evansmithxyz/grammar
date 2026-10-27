#!/usr/bin/env bash
# Builds the site and puts it, with the parse server, on your server over SSH.
# Run from Git Bash (or any bash) on your computer:
#
#   scripts/deploy.sh root@203.0.113.7 --setup   # first time: also installs Caddy, Python and spaCy
#   scripts/deploy.sh root@203.0.113.7           # after that: just the new site and server code
#
# For --setup, MODEL=en_core_web_sm|en_core_web_trf and DOMAIN=diagrams.example.com
# are passed through to deploy/setup.sh.
set -euo pipefail

HOST=${1:?usage: scripts/deploy.sh user@host [--setup]}
cd "$(dirname "$0")/.."

npm run build

echo "== Uploading the parse server and config"
tar -cf - server/app.py server/requirements.txt server/constraints.txt deploy \
  | ssh "$HOST" 'mkdir -p /opt/sentence-grapher && tar -C /opt/sentence-grapher -xf - && sed -i "s/\r$//" /opt/sentence-grapher/deploy/*'

if [ "${2:-}" = --setup ]; then
  ssh "$HOST" "MODEL='${MODEL:-}' DOMAIN='${DOMAIN:-}' bash /opt/sentence-grapher/deploy/setup.sh"
else
  ssh "$HOST" 'systemctl restart sentence-grapher-parser'
fi

echo "== Uploading the site"
# unpack beside the live copy, then swap, so nobody is served half a site
tar -C dist -cf - . | ssh "$HOST" 'set -e
  rm -rf /srv/sentence-grapher.new /srv/sentence-grapher.old
  mkdir -p /srv/sentence-grapher.new
  tar -C /srv/sentence-grapher.new -xf -
  chmod -R a+rX /srv/sentence-grapher.new
  if [ -d /srv/sentence-grapher ]; then mv /srv/sentence-grapher /srv/sentence-grapher.old; fi
  mv /srv/sentence-grapher.new /srv/sentence-grapher
  rm -rf /srv/sentence-grapher.old'

site=$(ssh "$HOST" '. /etc/sentence-grapher.env 2>/dev/null; echo "${DOMAIN:-}"')
# on a server whose Caddyfile comes from ../homesite, a homepage has the root and the site is in /diagrammer/
folder=$(ssh "$HOST" 'grep -qs "handle_path /diagrammer/" /etc/caddy/Caddyfile && echo diagrammer/ || true')
if [ -n "$site" ]; then echo "== Done: https://$site/$folder"; else echo "== Done: http://${HOST#*@}/$folder"; fi

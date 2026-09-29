#!/usr/bin/env bash
# Конфиг nginx сайта (deploy/nginx) → сервер: резервная копия, загрузка, `nginx -t`, reload.
# Если проверка конфига не прошла — возвращаем прежний и nginx не трогаем. Конфиг api.bee-dynasty.ru
# не меняется.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@185.166.196.106}"
KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/beeline_deploy}"
SITE_URL="${DEPLOY_URL:-https://bee-dynasty.ru}"
SITE=/etc/nginx/sites-available/bee-dynasty.conf
SNIPPET=/etc/nginx/snippets/bee-dynasty-proxy.conf

SSH=(ssh -i "$KEY" -o BatchMode=yes)
cd "$(dirname "$0")/.."

STAMP="$(date +%Y%m%d-%H%M%S)"
echo "→ резервная копия ($STAMP)"
"${SSH[@]}" "$HOST" "cp -a $SITE $SITE.bak-$STAMP; [ -f $SNIPPET ] && cp -a $SNIPPET $SNIPPET.bak-$STAMP || true"

echo "→ загрузка"
scp -q -i "$KEY" -o BatchMode=yes deploy/nginx/bee-dynasty.conf "$HOST:$SITE"
scp -q -i "$KEY" -o BatchMode=yes deploy/nginx/bee-dynasty-proxy.conf "$HOST:$SNIPPET"

echo "→ nginx -t"
if ! "${SSH[@]}" "$HOST" "nginx -t"; then
  echo "конфиг не прошёл проверку — возвращаем прежний"
  "${SSH[@]}" "$HOST" "cp -a $SITE.bak-$STAMP $SITE; if [ -f $SNIPPET.bak-$STAMP ]; then cp -a $SNIPPET.bak-$STAMP $SNIPPET; else rm -f $SNIPPET; fi"
  exit 1
fi
"${SSH[@]}" "$HOST" "systemctl reload nginx"

echo "→ проверка $SITE_URL"
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/")
api=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/api/v1/auth/me")
csp=$(curl -s -D - -o /dev/null "$SITE_URL/" | grep -ci '^content-security-policy' || true)
echo "   страница: $code, /api/v1/auth/me без токена: $api, CSP: $csp"
[ "$code" = "200" ] && [ "$api" = "401" ] && [ "$csp" = "1" ] || { echo "проверка не прошла"; exit 1; }
echo "готово. Откат: cp $SITE.bak-$STAMP $SITE && nginx -t && systemctl reload nginx"

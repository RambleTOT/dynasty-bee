#!/usr/bin/env bash
# Деплой фронтенда на сервер бэка: сборка → rsync в новый релиз → переключение симлинка current.
# Откат: ssh на сервер и `ln -sfn <предыдущий релиз> /var/www/bee-dynasty/current`.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@185.166.196.106}"
KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/beeline_deploy}"
BASE=/var/www/bee-dynasty
SITE_URL="${DEPLOY_URL:-https://bee-dynasty.ru}"
KEEP=5

SSH=(ssh -i "$KEY" -o BatchMode=yes)
cd "$(dirname "$0")/.."

echo "→ сборка"
npm run build

RELEASE="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
echo "→ загрузка релиза $RELEASE"
"${SSH[@]}" "$HOST" "mkdir -p $BASE/releases/$RELEASE"
rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" dist/ "$HOST:$BASE/releases/$RELEASE/"

echo "→ переключение current"
"${SSH[@]}" "$HOST" "ln -sfn $BASE/releases/$RELEASE $BASE/current \
  && ls -1dt $BASE/releases/* | tail -n +$((KEEP + 1)) | xargs -r rm -rf"

echo "→ проверка $SITE_URL"
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/")
api=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/api/v1/auth/me")
echo "   страница: $code, API через прокси (/auth/me без токена, ждём 401): $api"
[ "$code" = "200" ] && [ "$api" = "401" ] || { echo "проверка не прошла"; exit 1; }
echo "готово: $SITE_URL (релиз $RELEASE)"

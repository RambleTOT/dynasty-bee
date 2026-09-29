#!/usr/bin/env bash
# Базовая защита сервера стенда (S1 из docs/BACKEND_REQUESTS2.md).
#
# Что делает:
#   1) fail2ban для SSH;
#   2) файрвол ufw: открыты только 22/tcp, 80/tcp, 443/tcp (и 8443/9443 при необходимости);
#   3) по желанию отключает вход по паролю (только после того, как ключи всех
#      участников лежат в authorized_keys).
#
# ВНИМАНИЕ: запускать от root, осознанно, обязательно оставив активную SSH-сессию.
# Проверка синтаксиса: bash -n deploy/security/harden-server.sh
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
DISABLE_PASSWORD_AUTH="${DISABLE_PASSWORD_AUTH:-no}"   # yes — только после проверки ключей

echo "==> Установка fail2ban и ufw"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y fail2ban ufw

echo "==> Jail для sshd"
cat >/etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
backend = systemd
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Файрвол"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
# Альтернативные порты фронта (если используются):
# ufw allow 8443/tcp
# ufw allow 9443/tcp
ufw --force enable

if [ "${DISABLE_PASSWORD_AUTH}" = "yes" ]; then
  echo "==> Отключение входа по паролю (ключи обязательны!)"
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  systemctl reload sshd
fi

echo "==> Готово. Проверьте: ufw status; fail2ban-client status sshd"

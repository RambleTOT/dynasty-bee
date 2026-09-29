#!/usr/bin/env bash
# Защита сервера 185.166.196.106 (docs/SECURITY.md). Запускать под root на сервере:
#   ssh -i ~/.ssh/beeline_deploy root@185.166.196.106 'bash -s' < deploy/security/harden-server.sh
# Каждый шаг можно выполнить отдельно. Шаг 3 (SSH только по ключу) по умолчанию выключен:
# сначала убедитесь, что у всех, кому нужен доступ, ключ лежит в /root/.ssh/authorized_keys.
set -euo pipefail

SSH_KEY_ONLY="${SSH_KEY_ONLY:-no}"   # yes — запретить вход по паролю

echo "→ 1. fail2ban: бан IP за перебор пароля SSH и за поток запросов на сайт"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban
cat > /etc/fail2ban/jail.d/bee-dynasty.local <<'EOF'
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h

# nginx отвечает 429 и пишет «limiting requests» — упорных банним на 10 минут
[nginx-limit-req]
enabled  = true
port     = http,https,8443,9443
logpath  = /var/log/nginx/bee-dynasty.error.log
maxretry = 30
findtime = 1m
bantime  = 10m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban
fail2ban-client status

echo "→ 2. файрвол: наружу только SSH, сайт и мониторинг хостинга"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80,443,8443,9443/tcp
for ip in 92.53.116.12 92.53.116.111 92.53.116.119; do   # zabbix хостинга (Server= в zabbix_agentd.conf)
  ufw allow from "$ip" to any port 10050 proto tcp
done
ufw --force enable
ufw status verbose
# Порты, опубликованные Docker (8000), ufw не закрывает — их закрывает compose (docs/SECURITY.md, шаг 4).

if [ "$SSH_KEY_ONLY" = "yes" ]; then
  echo "→ 3. SSH только по ключу"
  cat > /etc/ssh/sshd_config.d/00-bee-dynasty.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
EOF
  sshd -t
  systemctl reload ssh
  sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|maxauthtries) '
else
  echo "→ 3. пропущен: SSH_KEY_ONLY=yes, когда у всех будет ключ"
fi
echo "готово"

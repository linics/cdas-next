#!/usr/bin/env bash
# Remove the previous score-my-lover stack so the 2GB VPS only hosts CDAS Next.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

systemctl disable --now score-my-lover.service 2>/dev/null || true
systemctl disable --now score-my-lover-healthcheck.timer 2>/dev/null || true
systemctl disable --now score-my-lover-healthcheck.service 2>/dev/null || true

rm -f /etc/systemd/system/score-my-lover.service
rm -f /etc/systemd/system/score-my-lover-healthcheck.service
rm -f /etc/systemd/system/score-my-lover-healthcheck.timer
rm -f /usr/local/sbin/score-my-lover-healthcheck
rm -f /etc/nginx/conf.d/score-my-lover-limits.conf
rm -f /etc/nginx/sites-enabled/score-my-lover
rm -f /etc/nginx/sites-available/score-my-lover

systemctl daemon-reload

if [[ -d /opt/score-my-lover ]]; then
  rm -rf /opt/score-my-lover
fi
if [[ -d /var/lib/score-my-lover ]]; then
  rm -rf /var/lib/score-my-lover
fi

if command -v nginx >/dev/null 2>&1; then
  nginx -t
  systemctl reload nginx || true
fi

echo "score-my-lover removed."

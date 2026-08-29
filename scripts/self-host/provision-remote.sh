#!/usr/bin/env bash
# Idempotent remote provision for a small Ubuntu VPS hosting only CDAS Next.
# Intended to run on the VPS as root after score-my-lover is removed.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release nginx rsync openssl

# PostgreSQL 17 from PGDG when the distro only has an older major.
if ! command -v psql >/dev/null 2>&1 || ! psql --version | grep -q ' 17\.'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
  . /etc/os-release
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    >/etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y --no-install-recommends postgresql-17
fi

systemctl enable --now postgresql

install -d -m 0755 /opt/cdas-next /opt/cdas-next/releases /opt/cdas-next/shared
install -d -m 0750 -o ubuntu -g ubuntu /opt/cdas-next/shared
install -d -m 0755 -o ubuntu -g ubuntu /opt/cdas-next/releases

# Prefer the Node 24 tree already present on this VPS when available.
if [[ -x /opt/node-v24.18.0/bin/node ]]; then
  ln -sfn /opt/node-v24.18.0 /opt/cdas-next/node
elif [[ -x /opt/cdas-next/node/bin/node ]]; then
  true
else
  NODE_VERSION=v24.20.0
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
    -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /opt
  ln -sfn "/opt/node-${NODE_VERSION}" /opt/cdas-next/node
  rm -f /tmp/node.tar.xz
fi

DB_PASSWORD_FILE=/opt/cdas-next/shared/db-password
if [[ ! -f "$DB_PASSWORD_FILE" ]]; then
  openssl rand -base64 24 | tr -d '\n' >"$DB_PASSWORD_FILE"
  chmod 0600 "$DB_PASSWORD_FILE"
  chown ubuntu:ubuntu "$DB_PASSWORD_FILE"
fi
DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cdas') THEN
    CREATE ROLE cdas LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE cdas WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE cdas_next OWNER cdas'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cdas_next')\gexec
GRANT ALL PRIVILEGES ON DATABASE cdas_next TO cdas;
SQL

sudo -u postgres psql -v ON_ERROR_STOP=1 -d cdas_next <<SQL
ALTER SCHEMA public OWNER TO cdas;
GRANT ALL ON SCHEMA public TO cdas;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO cdas;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO cdas;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO cdas;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO cdas;
SQL

PG_MAJOR="$(sudo -u postgres psql -tAc 'SHOW server_version_num' | cut -c1-2)"
CONF_DIR="/etc/postgresql/${PG_MAJOR}/main/conf.d"
if [[ -d "$CONF_DIR" ]]; then
  install -m 0644 /opt/cdas-next/shared/postgresql-cdas.conf "$CONF_DIR/cdas.conf" 2>/dev/null \
    || true
  systemctl reload postgresql || systemctl restart postgresql
fi

ENV_FILE=/opt/cdas-next/shared/.env
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat >"$ENV_FILE" <<EOF
DATABASE_URL=postgresql://cdas:${DB_PASSWORD}@127.0.0.1:5432/cdas_next
DIRECT_URL=postgresql://cdas:${DB_PASSWORD}@127.0.0.1:5432/cdas_next
AI_PROVIDER_DISABLED=1
ATTACHMENT_STORAGE_ENABLED=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
EOF
  chown ubuntu:ubuntu "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
fi

install -m 0644 /opt/cdas-next/shared/cdas-next.service /etc/systemd/system/cdas-next.service 2>/dev/null || true
install -m 0644 /opt/cdas-next/shared/nginx-cdas-next-map.conf /etc/nginx/conf.d/cdas-next-map.conf 2>/dev/null || true
install -m 0644 /opt/cdas-next/shared/nginx-cdas-next.conf /etc/nginx/sites-available/cdas-next 2>/dev/null || true
ln -sfn /etc/nginx/sites-available/cdas-next /etc/nginx/sites-enabled/cdas-next
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx
systemctl daemon-reload
systemctl enable cdas-next.service || true

echo "Provision complete. Upload a release and start cdas-next.service."

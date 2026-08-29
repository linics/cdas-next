#!/usr/bin/env bash
# Build a Next.js standalone release here, then provision and deploy to the China VPS.
#
# Required env:
#   CDAS_VPS_SSH_PRIVATE_KEY  PEM contents (or path via CDAS_VPS_SSH_KEY_FILE)
# Optional:
#   CDAS_VPS_HOST             default 122.51.77.121
#   CDAS_VPS_USER             default ubuntu
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY
#   DEEPSEEK_API_KEY / AI_TOOL_APPROVAL_SECRET / AI_MODEL / AI_PROVIDER_DISABLED
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

HOST="${CDAS_VPS_HOST:-122.51.77.121}"
USER_NAME="${CDAS_VPS_USER:-ubuntu}"
SSH_KEY_FILE="${CDAS_VPS_SSH_KEY_FILE:-}"
RELEASE_ID="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cdas-release.XXXXXX")"
CLEANUP_KEY=0

cleanup() {
  rm -rf "$STAGING_DIR"
  if [[ "$CLEANUP_KEY" -eq 1 && -n "${SSH_KEY_FILE:-}" ]]; then
    rm -f "$SSH_KEY_FILE"
  fi
}
trap cleanup EXIT

if [[ -z "$SSH_KEY_FILE" ]]; then
  if [[ -n "${CDAS_VPS_SSH_PRIVATE_KEY:-}" ]]; then
    SSH_KEY_FILE="$(mktemp "${TMPDIR:-/tmp}/cdas-vps-key.XXXXXX")"
    CLEANUP_KEY=1
    # Preserve PEM newlines if the secret was stored with literal \n.
    if printf '%s' "$CDAS_VPS_SSH_PRIVATE_KEY" | grep -q '\\n'; then
      printf '%s\n' "$CDAS_VPS_SSH_PRIVATE_KEY" | sed 's/\\n/\n/g' >"$SSH_KEY_FILE"
    else
      printf '%s\n' "$CDAS_VPS_SSH_PRIVATE_KEY" >"$SSH_KEY_FILE"
    fi
    chmod 600 "$SSH_KEY_FILE"
  elif [[ -f "$HOME/.ssh/yunservice.pem" ]]; then
    SSH_KEY_FILE="$HOME/.ssh/yunservice.pem"
  else
    echo "Missing CDAS_VPS_SSH_PRIVATE_KEY or CDAS_VPS_SSH_KEY_FILE (or ~/.ssh/yunservice.pem)." >&2
    exit 1
  fi
fi

SSH=(ssh -i "$SSH_KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
RSYNC_RSH="ssh -i ${SSH_KEY_FILE} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
REMOTE="${USER_NAME}@${HOST}"

echo "==> Checking SSH ${REMOTE}"
"${SSH[@]}" "$REMOTE" 'echo ok; uname -a'

echo "==> Building standalone release"
export PATH="${HOME}/.nvm/versions/node/v24.20.0/bin:/opt/cdas-next/node/bin:${PATH}"
if ! command -v node >/dev/null; then
  echo "Node is required on the build machine." >&2
  exit 1
fi
NODE_MAJOR="$(node -v | tr -d v | cut -d. -f1)"
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "Node >= 24 required (found $(node -v))." >&2
  exit 1
fi

export CDAS_DEPLOYMENT_ID="$(git rev-parse HEAD)"
export AI_PROVIDER_DISABLED="${AI_PROVIDER_DISABLED:-1}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/cdas_next}"

pnpm install --frozen-lockfile
pnpm build

if [[ ! -d .next/standalone ]]; then
  echo "Missing .next/standalone — ensure next.config.ts sets output: \"standalone\"." >&2
  exit 1
fi

echo "==> Staging ${RELEASE_ID}"
mkdir -p "$STAGING_DIR/app" "$STAGING_DIR/shared"
cp -a .next/standalone/. "$STAGING_DIR/app/"
mkdir -p "$STAGING_DIR/app/.next"
cp -a .next/static "$STAGING_DIR/app/.next/static"
if [[ -d public ]]; then
  cp -a public "$STAGING_DIR/app/public"
fi
cp -a prisma "$STAGING_DIR/app/prisma"
cp -a prisma.config.ts "$STAGING_DIR/app/prisma.config.ts"
if [[ -d corpus ]]; then
  cp -a corpus "$STAGING_DIR/app/corpus"
fi

cp deploy/self-host/cdas-next.service "$STAGING_DIR/shared/"
cp deploy/self-host/nginx-cdas-next.conf "$STAGING_DIR/shared/"
cp deploy/self-host/nginx-cdas-next-map.conf "$STAGING_DIR/shared/"
cp deploy/self-host/postgresql-cdas.conf "$STAGING_DIR/shared/"
cp scripts/self-host/remove-score-my-lover.sh "$STAGING_DIR/shared/"
cp scripts/self-host/provision-remote.sh "$STAGING_DIR/shared/"
chmod +x "$STAGING_DIR/shared/"*.sh

echo "==> Removing score-my-lover and provisioning PostgreSQL/nginx"
rsync -az -e "$RSYNC_RSH" "$STAGING_DIR/shared/" "$REMOTE:/tmp/cdas-self-host-shared/"
"${SSH[@]}" "$REMOTE" 'sudo bash /tmp/cdas-self-host-shared/remove-score-my-lover.sh'
"${SSH[@]}" "$REMOTE" 'sudo install -d -m 0755 /opt/cdas-next/shared && sudo cp -a /tmp/cdas-self-host-shared/. /opt/cdas-next/shared/ && sudo bash /opt/cdas-next/shared/provision-remote.sh'

echo "==> Uploading release"
"${SSH[@]}" "$REMOTE" "sudo install -d -m 0755 -o ${USER_NAME} -g ${USER_NAME} /opt/cdas-next/releases/${RELEASE_ID}"
rsync -az --delete -e "$RSYNC_RSH" "$STAGING_DIR/app/" "$REMOTE:/opt/cdas-next/releases/${RELEASE_ID}/"
"${SSH[@]}" "$REMOTE" "sudo ln -sfn /opt/cdas-next/releases/${RELEASE_ID} /opt/cdas-next/current && sudo chown -R ${USER_NAME}:${USER_NAME} /opt/cdas-next/releases/${RELEASE_ID}"

echo "==> Merging runtime env overrides"
OVERRIDES="$(mktemp)"
{
  [[ -n "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]] && printf 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=%s\n' "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  [[ -n "${CLERK_SECRET_KEY:-}" ]] && printf 'CLERK_SECRET_KEY=%s\n' "$CLERK_SECRET_KEY"
  [[ -n "${DEEPSEEK_API_KEY:-}" ]] && printf 'DEEPSEEK_API_KEY=%s\n' "$DEEPSEEK_API_KEY"
  [[ -n "${AI_TOOL_APPROVAL_SECRET:-}" ]] && printf 'AI_TOOL_APPROVAL_SECRET=%s\n' "$AI_TOOL_APPROVAL_SECRET"
  [[ -n "${AI_MODEL:-}" ]] && printf 'AI_MODEL=%s\n' "$AI_MODEL"
  printf 'AI_PROVIDER_DISABLED=%s\n' "${AI_PROVIDER_DISABLED:-1}"
} >"$OVERRIDES"
rsync -az -e "$RSYNC_RSH" "$OVERRIDES" "$REMOTE:/tmp/cdas-env-overrides.env"
rm -f "$OVERRIDES"

"${SSH[@]}" "$REMOTE" 'sudo python3 - <<'"'"'PY'"'"'
from pathlib import Path
env_path = Path("/opt/cdas-next/shared/.env")
sidecar = Path("/tmp/cdas-env-overrides.env")
text = env_path.read_text() if env_path.exists() else ""
overrides = {}
for line in sidecar.read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if value != "":
        overrides[key] = value
lines = []
seen = set()
for line in text.splitlines():
    if "=" in line and not line.strip().startswith("#"):
        key = line.split("=", 1)[0]
        if key in overrides:
            lines.append(f"{key}={overrides[key]}")
            seen.add(key)
            continue
    lines.append(line)
for key, value in overrides.items():
    if key not in seen:
        lines.append(f"{key}={value}")
env_path.write_text("\n".join(lines) + "\n")
print("merged", sorted(overrides))
PY
sudo chown ubuntu:ubuntu /opt/cdas-next/shared/.env
sudo chmod 600 /opt/cdas-next/shared/.env
rm -f /tmp/cdas-env-overrides.env'

echo "==> Installing Prisma CLI on VPS (once) and migrating"
"${SSH[@]}" "$REMOTE" 'export PATH=/opt/cdas-next/node/bin:$PATH
if ! command -v prisma >/dev/null 2>&1; then
  npm install -g prisma@7.9.1 dotenv@16
fi
set -a
. /opt/cdas-next/shared/.env
set +a
cd /opt/cdas-next/current
# prisma.config.ts imports dotenv/config; ensure it resolves from the app dir.
if [[ ! -d node_modules/dotenv ]]; then
  npm install --no-save --prefix /opt/cdas-next/current dotenv@16
fi
prisma migrate deploy'

echo "==> Restarting cdas-next"
"${SSH[@]}" "$REMOTE" 'sudo cp /opt/cdas-next/shared/cdas-next.service /etc/systemd/system/cdas-next.service
sudo cp /opt/cdas-next/shared/nginx-cdas-next-map.conf /etc/nginx/conf.d/cdas-next-map.conf
sudo cp /opt/cdas-next/shared/nginx-cdas-next.conf /etc/nginx/sites-available/cdas-next
sudo ln -sfn /etc/nginx/sites-available/cdas-next /etc/nginx/sites-enabled/cdas-next
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemctl enable --now cdas-next.service
sudo systemctl restart cdas-next.service
sleep 2
sudo systemctl --no-pager --full status cdas-next.service | head -40'

echo "==> Smoke"
"${SSH[@]}" "$REMOTE" 'curl -sS -o /tmp/cdas-health.json -w "%{http_code}" http://127.0.0.1:3000/api/health; echo; head -c 400 /tmp/cdas-health.json; echo'
curl -sS -o /tmp/cdas-public-health.json -w "public_http=%{http_code}\n" "http://${HOST}/api/health" || true
head -c 400 /tmp/cdas-public-health.json 2>/dev/null || true
echo

echo "Deployed ${RELEASE_ID} to ${HOST}"

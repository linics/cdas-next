# Self-host CDAS Next on a small China VPS

Status: operator runbook for replacing Vercel/Neon with a single Ubuntu host.
Default target: `122.51.77.121` (Tencent SA3.MEDIUM2, 2C/2G). The previous
`score-my-lover` service is removed so this host only runs CDAS Next + PostgreSQL.

## Capacity

- Fits small-class demo / internal trial (about 1 teacher + 5–15 light students).
- Keep `AI_PROVIDER_DISABLED=1` and leave attachments off on 2GB RAM.
- Never run `pnpm build` on the VPS; build on a workstation or CI, then upload the standalone release.

## One-shot deploy

From the repo root on a machine that can SSH to the VPS:

```bash
export CDAS_VPS_SSH_KEY_FILE=~/.ssh/yunservice.pem
# or: export CDAS_VPS_SSH_PRIVATE_KEY="$(cat ~/.ssh/yunservice.pem)"
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
export CLERK_SECRET_KEY=sk_...
# optional:
# export DEEPSEEK_API_KEY=...
# export AI_TOOL_APPROVAL_SECRET=...
# export AI_PROVIDER_DISABLED=0

chmod +x scripts/self-host/*.sh
./scripts/self-host/deploy.sh
```

The script:

1. Builds `output: "standalone"` locally
2. Deletes `score-my-lover` on the VPS
3. Installs PostgreSQL 17, nginx, and `cdas-next.service`
4. Uploads the release under `/opt/cdas-next/releases/<id>`
5. Runs `prisma migrate deploy`
6. Restarts the app and curls `/api/health`

## Layout on the VPS

| Path | Role |
| --- | --- |
| `/opt/cdas-next/current` | Symlink to active release |
| `/opt/cdas-next/shared/.env` | Runtime secrets (`0600`) |
| `/opt/cdas-next/node` | Node 24 tree |
| `/etc/systemd/system/cdas-next.service` | Process manager |
| `/etc/nginx/sites-enabled/cdas-next` | HTTP reverse proxy to `127.0.0.1:3000` |

## Clerk / DNS

Clerk production login needs a real HTTPS origin. After DNS `A` → `122.51.77.121`:

1. Add the origin and redirect URLs in the Clerk Dashboard
2. Issue a certificate (for example `certbot --nginx -d your.domain`)
3. Point `server_name` in the nginx site at that domain

Until then the app still answers on `http://122.51.77.121` for process/database smoke checks; browser login may be limited.

## What stays on Vercel

Development Preview, Neon staging, and the protected GitHub acceptance gates stay on Vercel/Neon. This VPS is a second runtime for China latency, not a replacement for those gates.

# Self-host CDAS Next on a small China VPS

Status: operator runbook for a single Ubuntu host running CDAS Next, PostgreSQL 17 and nginx.

The current default target is `122.51.77.121` (2C/2G). It is suitable only for a small demo or internal trial. Keep `AI_PROVIDER_DISABLED=1` on 2 GB RAM and never build on the VPS; build on a workstation or CI, then upload the standalone release.

## Storage

Self-hosted attachments use persistent local disk:

```dotenv
ATTACHMENT_STORAGE_ENABLED=1
ATTACHMENT_STORAGE_DIR=/opt/cdas-next/shared/attachments
```

The directory is outside `releases/`, so release rotation does not touch student files. Back it up together with PostgreSQL. The product verifies declared media type and file signature, but does not claim malware scanning.

## Public entry

On the current Tencent host without ICP filing, the supported origin is:

`http://122.51.77.121`

Custom HTTP domains may be redirected and inbound TLS may be filtered before nginx. After an ICP-filed domain is available, configure TLS and change `CDAS_PUBLIC_ORIGIN` to the final HTTPS origin. Local authentication has no external identity-provider origin or callback configuration.

## One-shot deploy

From the repository root on a machine that can SSH to the VPS:

```bash
export CDAS_VPS_SSH_KEY_FILE=/absolute/path/to/yunservice.pem
export CDAS_PUBLIC_ORIGIN=http://122.51.77.121

# Optional; keep disabled on the 2 GB host unless capacity is reviewed.
# export DEEPSEEK_API_KEY=...
# export AI_TOOL_APPROVAL_SECRET=...
# export AI_ATTACHMENT_VISION_MODEL=deepseek-v4-flash-vision-exp
# export AI_PROVIDER_DISABLED=0

pnpm self-host:deploy
```

The deploy script:

1. builds the Next.js standalone release locally;
2. provisions PostgreSQL 17, nginx, persistent attachment storage and systemd;
3. uploads a timestamped release under `/opt/cdas-next/releases/<id>`;
4. runs `prisma migrate deploy`;
5. switches `/opt/cdas-next/current`, restarts the app and checks health/routes;
6. removes retired identity-provider keys from the existing remote `.env`.

The script replaces the previous `score-my-lover` service on this dedicated host. Do not run it against a shared or production host without first reviewing that destructive scope.

## Bootstrap the platform administrator

After the first deploy, open an SSH tunnel to PostgreSQL and run the interactive bootstrap from the repository checkout:

```bash
ssh -i /absolute/path/to/yunservice.pem \
  -N -L 15432:127.0.0.1:5432 ubuntu@122.51.77.121
```

In another terminal, use the database password from `/opt/cdas-next/shared/.env` without printing it:

```bash
export DATABASE_URL='postgresql://cdas:<password>@127.0.0.1:15432/cdas_next'
export DIRECT_URL="$DATABASE_URL"
pnpm bootstrap:admin \
  --admin-username operator \
  --admin-name "平台管理员" \
  --confirm-database cdas_next
```

The command prompts twice for a hidden password and never accepts a password argument. Log in at `/login/admin`, then create the school and provision teacher/student accounts through the product workflow. Do not seed production-shaped accounts with gate passwords.

## Layout on the VPS

| Path | Role |
| --- | --- |
| `/opt/cdas-next/current` | symlink to active release |
| `/opt/cdas-next/releases/` | timestamped standalone releases |
| `/opt/cdas-next/shared/.env` | runtime secrets, mode `0600` |
| `/opt/cdas-next/shared/attachments` | persistent private attachments |
| `/opt/cdas-next/node` | Node 24 runtime |
| `/etc/systemd/system/cdas-next.service` | process manager |
| `/etc/nginx/sites-enabled/cdas-next` | reverse proxy to `127.0.0.1:3000` |

## What stays on Vercel

Development Preview, isolated Neon staging and protected GitHub acceptance gates stay on Vercel/Neon. This VPS is a separate China-latency runtime and does not replace those gates or authorize real student data.

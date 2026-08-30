# Self-host CDAS Next on a small China VPS

Status: operator runbook for replacing Vercel/Neon with a single Ubuntu host.
Default target: `122.51.77.121` (Tencent SA3.MEDIUM2, 2C/2G). The previous
`score-my-lover` service is removed so this host only runs CDAS Next + PostgreSQL.

## Capacity

- Fits small-class demo / internal trial (about 1 teacher + 5–15 light students).
- Keep `AI_PROVIDER_DISABLED=1` on 2GB RAM.
- Attachments run on this box's own disk. Set both:

  ```
  ATTACHMENT_STORAGE_ENABLED=1
  ATTACHMENT_STORAGE_DIR=/opt/cdas-next/shared/attachments
  ```

  That path sits **outside** `releases/`, so the `--link-dest` rotation a deploy
  performs never touches student files. Budget disk for 20MB x 5 per submission,
  and back that directory up alongside the database — nothing else holds those
  bytes.

  The guarantee matches the Vercel Blob path rather than weakening it: that one
  never scanned for malware either. Both verify the declared media type against
  the file's own signature, through the same shared check, and reject a file
  renamed into a type it is not.
- Never run `pnpm build` on the VPS; build on a workstation or CI, then upload the standalone release.

## Public entry (Tencent without ICP)

On this Tencent instance **without ICP备案**:

| Path | Result |
| --- | --- |
| `http://122.51.77.121` | Works (nginx → app). **Use this.** |
| Custom / sslip.io domain on :80 | DNSPod webblock redirect (unfiled domain) |
| Inbound TLS on :443 / :8443 | Often TCP-accept then drop ClientHello before nginx |

So the supported public origin today is:

`http://122.51.77.121`

Set Clerk **development** instance `development_origin` + `allowed_origins` to that URL
(API: `PATCH https://api.clerk.com/v1/instance`). Do **not** set systemd
`HOSTNAME=127.0.0.1` — that makes Clerk rewrite to `https://localhost:3000` and hang.

When you have an ICP-filed domain pointing at this IP, issue Let's Encrypt, put
TLS nginx in place, and point Clerk at `https://your.domain`.

## One-shot deploy

From the repo root on a machine that can SSH to the VPS:

```bash
export CDAS_VPS_SSH_KEY_FILE=~/.ssh/yunservice.pem
# or: export CDAS_VPS_SSH_PRIVATE_KEY="$(cat ~/.ssh/yunservice.pem)"
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
export CLERK_SECRET_KEY=sk_...
export CDAS_PUBLIC_ORIGIN=http://122.51.77.121
# optional:
# export DEEPSEEK_API_KEY=...
# export AI_TOOL_APPROVAL_SECRET=...
# export AI_ATTACHMENT_VISION_MODEL=deepseek-v4-flash-vision-exp
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
6. Restarts the app and curls `/api/health` + `/teacher`

## Demo seed (after first deploy)

From the laptop (SSH tunnel to Postgres):

```bash
ssh -i ~/.ssh/yunservice.pem -N -L 15432:127.0.0.1:5432 ubuntu@122.51.77.121 &
# DATABASE_URL from /opt/cdas-next/shared/.env with host 127.0.0.1:15432
export DATABASE_URL=postgresql://cdas:...@127.0.0.1:15432/cdas_next
export DIRECT_URL="$DATABASE_URL"
# plus DEV_TEST_TEACHER_CLERK_ID / DEV_TEST_STUDENT_CLERK_ID from .env.local
pnpm demo:seed -- --confirm-database cdas_next --reset
```

Open `http://122.51.77.121/teacher` or `/student` and sign in with the Clerk
users that match those IDs.

## Layout on the VPS

| Path | Role |
| --- | --- |
| `/opt/cdas-next/current` | Symlink to active release |
| `/opt/cdas-next/shared/.env` | Runtime secrets (`0600`) |
| `/opt/cdas-next/node` | Node 24 tree |
| `/etc/systemd/system/cdas-next.service` | Process manager |
| `/etc/nginx/sites-enabled/cdas-next` | HTTP reverse proxy to `127.0.0.1:3000` |

## What stays on Vercel

Development Preview, Neon staging, and the protected GitHub acceptance gates stay on Vercel/Neon. This VPS is a second runtime for China latency, not a replacement for those gates.

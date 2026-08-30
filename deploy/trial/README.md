# Isolated v3 trial on `platformilc_tencent`

This stack is intentionally separate from `deploy/self-host` and from the
PlatformILC containers already running on the host.

- Remote root: `/home/ubuntu/cdas-next-v3-trial`
- Compose project: `cdas-next-v3-trial`
- Database: named volume `cdas-next-v3-trial-postgres`, database
  `cdas_next_v3_trial`
- Browser entry: server loopback `127.0.0.1:3001`, accessed only through an
  SSH local tunnel
- AI and attachments: disabled

## Local secret input

Copy `trial.env.example` to the repository root as `.env.trial.local` and
fill it with exactly one Clerk **development** teacher and student. The file is
ignored by Git and Docker. It may contain only these keys:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
DEV_TEST_TEACHER_CLERK_ID=user_...
DEV_TEST_STUDENT_CLERK_ID=user_...
```

The deployment uploads this minimal input with mode `0600`; the bootstrap
script validates the key prefixes, generates a server-only PostgreSQL password,
and writes `runtime.env`. It rejects production Clerk keys and any AI key.

## Server lifecycle

After source sync and environment bootstrap, run from the remote source root:

```bash
sudo docker compose --project-name cdas-next-v3-trial \
  --env-file ../runtime.env -f deploy/trial/compose.yaml up -d --no-build app

sudo docker compose --project-name cdas-next-v3-trial \
  --env-file ../runtime.env -f deploy/trial/compose.yaml --profile seed up --no-build seed
```

The first command starts PostgreSQL, applies migrations, performs the production
build after the database is healthy, and binds only `127.0.0.1:3001`. The second
command writes the v1/v2 demo baseline to the isolated database.

Stop the trial without erasing diagnostic data:

```bash
sudo docker compose --project-name cdas-next-v3-trial \
  --env-file ../runtime.env -f deploy/trial/compose.yaml down
```

Do not use `down -v`, delete the named volume, run Docker-wide cleanup, or run
`scripts/self-host/deploy.sh` on this shared server without separate approval.

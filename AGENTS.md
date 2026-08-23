<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CDAS Next repository rules

- Read `PRODUCT.md`, `DOMAIN.md`, `ACCEPTANCE.md`, and `AGENT.md` before changing business behavior.
- Keep the first phase inside one modular Next.js application. Do not add a second backend, workflow engine, RAG system, or multi-Agent layer without a new accepted decision record.
- Authentication identifies the caller; authorization belongs in server-side domain commands and must check resource ownership or membership on every call.
- UI actions and Agent tools must call the same domain commands. Neither may import Prisma directly.
- Published releases, submitted revisions, feedback revisions, action audits, and successful idempotency results are append-only business history.
- Never place model calls, authentication-provider calls, or object-storage calls inside a database transaction.
- Prefer established framework/library behavior over local abstractions. Introduce a wrapper only at an actual product boundary or where tests need a deterministic substitute.
- Any change to a domain command or invariant must update the relevant acceptance scenario in the same change.

## Development subagent routing

- Multi-Agent orchestration is a development workflow only. Do not add it to the CDAS product runtime or weaken the first-phase product boundary.
- For substantial work that benefits from independent exploration or verification, use the project `cdas-development` skill with GPT-5.6 Sol as the primary coordinator.
- Prefer `cdas_explorer` and `cdas_verifier` for bounded Luna read-heavy work, `cdas_builder` for one explicitly owned Terra implementation slice, and `cdas_reviewer` for independent Terra review.
- Keep delegation one level deep and at most three subagents active. Subagents must not spawn descendants.
- Parallelize independent reading, review, and verification. Allow only one source-code writer at a time; serialize dependent work and overlapping file ownership.
- The primary Sol thread retains product and domain decisions, authorization boundaries, Prisma and transaction invariants, append-only history, external side effects, integration, and final acceptance.

## Cursor Cloud specific instructions

The startup update script only runs `pnpm install --frozen-lockfile` (which also runs `prisma generate` via `postinstall`). Everything else below is per-session and must be started by hand. Standard commands live in `README.md` and `package.json` scripts; only the non-obvious cloud caveats are captured here.

### Node / pnpm

- Node 24 and pnpm 11 are already provisioned. Plain `node`/`pnpm`/`npm`/`npx` resolve to Node 24 via symlinks in `/usr/local/cargo/bin`, which precede the `/exec-daemon` Node 22 shim on `PATH`. Do not "fix" `PATH` or reinstall Node; if `node -v` ever shows v22, the symlinks are missing and can be re-pointed at `~/.nvm/versions/node/v24.19.0/bin`.

### PostgreSQL (Docker)

- Docker is installed but the daemon is NOT auto-started. Start it once per session (runs in the background): `sudo nohup dockerd >/tmp/dockerd.log 2>&1 &` then wait a few seconds. Docker 29 needs `/etc/docker/daemon.json` to disable `containerd-snapshotter` and use `fuse-overlayfs` (already configured).
- The `ubuntu` user is in the `docker` group, so a fresh session can run `docker`/`docker compose` without `sudo`. A session that started before the daemon/group existed may still need `sudo docker ...`.
- Bring up the three Postgres services with `docker compose up -d database test-database e2e-database` (ports 5432 dev, 5433 test, 5434 e2e). Only `database` uses a persistent volume; the test/e2e services are tmpfs and reset on recreate, so re-run `pnpm db:deploy` / `pnpm db:test:deploy` after recreating them.
- Create the local env file with `cp .env.example .env` (git-ignored); the defaults already point at the three local databases.

### Tests / build gotchas

- `pnpm test:db` (the vitest DB integration suite) reads `TEST_DATABASE_URL` from the process env and does NOT load `.env`. Export it first: `export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cdas_next_test`. The Prisma-based DB scripts (`db:test`, `db:test:deploy`, `db:test:diff`) do load `.env`.
- The production build intentionally uses Webpack (`next build --webpack`); the default Turbopack build stalls with the current dependency graph. `pnpm dev` uses Turbopack and is fine.
- `pnpm check` runs lint + typecheck + unit tests + the two Python acceptance suites + the Webpack build, but NOT the DB integration tests; run `pnpm test:db` separately (with the env var above) plus a running Postgres.

### Auth in dev (Clerk keyless) and provisioning a real user

- With no Clerk keys, `pnpm dev` uses Clerk keyless mode and writes a temporary publishable/secret key to `.clerk/.tmp/keyless.json`. `/api/health` returns `503 unconfigured` in keyless mode; that is expected and not a failure.
- Business pages need a Clerk user that is also provisioned in the DB. To exercise authenticated flows without external Clerk credentials: create users with the keyless secret via the Clerk Backend API (`POST https://api.clerk.com/v1/users`), then map them with `pnpm --silent bootstrap:clerk -- --teacher-subject <user_...> --student-subject <user_...> --classroom-id <uuid> --confirm-database cdas_next`. For browser sign-in, Clerk development instances accept `+clerk_test` email addresses with the fixed verification code `424242`.
- The full `pnpm e2e:closed-loop` / `pnpm e2e:real-model` gates additionally require pre-existing Clerk dev user IDs (`DEV_TEST_*_CLERK_ID`) and, for the model smoke, a real `DEEPSEEK_API_KEY`; these are not available by default.

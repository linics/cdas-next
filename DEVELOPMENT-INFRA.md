# Development infrastructure

`pnpm development:infra` reconciles the isolated synthetic development stack and then runs the protected synthetic acceptance workflow for the current pushed `codex/*` commit.

Create the ignored repository-root `.env.staging.local`, set its permissions to `600`, and provide only these variable names. Values must never be committed, pasted into issue text, or retained in artifacts.

```text
CDAS_DEVELOPMENT_INFRA_MANAGED
CDAS_INFRA_MASTER_SECRET
VERCEL_TOKEN
# Optional for a personal Vercel scope; required only when the token selects a team scope.
VERCEL_TEAM_ID
VERCEL_PROJECT_NAME
NEON_API_KEY
NEON_PROJECT_ID
NEON_STAGING_BRANCH_NAME
NEON_STAGING_DATABASE_NAME
NEON_STAGING_ROLE_NAME
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
```

The command reads that one file without mutating `process.env`. It derives the health-proof and Vercel bypass secrets in memory, creates or reuses only named synthetic Clerk identities and an isolated Neon schema-only branch/database, applies Prisma migrations only to that isolated direct connection, configures a branch-scoped encrypted Vercel Preview, and writes only the documented GitHub Environment variable/secret allowlists.

It refuses non-test Clerk keys, non-`codex/*` branches, dirty or unpushed HEADs, production-like Neon names, unknown Neon branch shapes, unsafe Vercel build commands, mismatched deployment SHA, and non-PASS acceptance artifacts. In its verifier child process it explicitly skips loading local `.env*` files, so no local model-provider credentials are read. For its fixed synthetic GitHub Environment it may remove only the legacy `codex/*` deployment policy and then enforce the exact current branch; it never deletes, resets, revokes, or rotates application or data resources.

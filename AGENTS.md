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

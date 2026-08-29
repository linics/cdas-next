<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CDAS Next repository rules

- Read `PRODUCT.md`, `DOMAIN.md`, `ACCEPTANCE.md`, and `AGENT.md` before changing business behavior.
- Any teacher/student-visible UI change must follow `design-system/cdas-next/CLASSICAL.md` and `src/app/globals.css` tokens. Do not follow historical `design-system/cdas-next/MASTER.md`.
- Keep the first phase inside one modular Next.js application. Do not add a second backend, workflow engine, RAG system, or multi-Agent layer without a new accepted decision record.
- Authentication identifies the caller; authorization belongs in server-side domain commands and must check resource ownership or membership on every call.
- UI actions and Agent tools must call the same domain commands. Neither may import Prisma directly.
- Published releases, submitted revisions, feedback revisions, action audits, and successful idempotency results are append-only business history.
- Never place model calls, authentication-provider calls, or object-storage calls inside a database transaction.
- Prefer established framework/library behavior over local abstractions. Introduce a wrapper only at an actual product boundary or where tests need a deterministic substitute.
- Any change to a domain command or invariant must update the relevant acceptance scenario in the same change.

## Delivery priority and review budget

- Optimize for shipping usable product slices. Fix P0/P1 (or T0/T1), authorization or data-integrity risks, and failures that block the accepted user journey, build, deployment, or required acceptance run.
- Treat P2/T2 compatibility edges, polish, speculative hardening, and optional test completeness as non-blocking backlog unless the user explicitly promotes them. Do not start another fix-review-retry loop solely to close them.
- Use focused checks for small changes. Run an independent reviewer, verifier, or duplicated full check matrix only when the slice is substantial, touches a protected invariant, or has an ambiguous P0/P1 failure.
- One review pass is the default. Record lower-severity findings concisely; re-review only changes made for blocking findings or when the risk surface materially changes.

## Development subagent routing

- Multi-Agent orchestration is a development workflow only. Do not add it to the CDAS product runtime or weaken the first-phase product boundary.
- For substantial work that benefits from independent exploration or verification, use the project `cdas-development` skill.
- **Codex**: GPT-5.6 Sol as primary coordinator; `cdas_explorer` and `cdas_verifier` for Luna read-heavy work; `cdas_builder` and `cdas_reviewer` for Terra implementation and review.
- **Cursor**: Grok 4.6 as primary coordinator, `cdas-builder`, and ordinary code review; `cdas-explorer` and `cdas-verifier` on Composer 2.5 `[fast=false]` (never Fast); `cdas-reviewer` on Fable 5 only for automatic protected-invariant must-call gates. See `.agents/skills/cdas-development/references/cursor-routing.md`.
- Keep delegation one level deep and at most three subagents active. Subagents must not spawn descendants.
- Parallelize independent reading, review, and verification. Allow only one source-code writer at a time; serialize dependent work and overlapping file ownership.
- The primary coordinator thread retains product and domain decisions, authorization boundaries, Prisma and transaction invariants, append-only history, external side effects, integration, and final acceptance.

## Development branch sync

On `codex/*` branches, the primary thread has standing authorization to push ordinary commits to the tracked origin branch after a local commit succeeds. GitHub CI and the connected Vercel Preview are part of the development loop; a local-only commit is incomplete. Do not wait for a per-session push request. Do not force-push. Do not push `main` or production. Subagents still must not push.

`pnpm development:infra` remains a separate step: it requires a clean, already-pushed HEAD. Run it when reconciling the isolated stack or protected synthetic acceptance, not as a substitute for `git push`.

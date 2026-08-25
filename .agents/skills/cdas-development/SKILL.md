---
name: cdas-development
description: Coordinate substantial CDAS Next feature, bug-fix, refactor, and review work with bounded Sol-led subagents while preserving product, domain, authorization, history, and acceptance-test invariants. Use for work that benefits from parallel exploration or independent verification; skip for small, ordered tasks where delegation adds overhead.
---

# CDAS Development

Use this skill only for the development workflow. It must not add a multi-Agent layer to the CDAS product runtime.

## Ground The Work

Before changing business behavior, read `PRODUCT.md`, `DOMAIN.md`, `ACCEPTANCE.md`, and `AGENT.md`. Read the relevant installed Next.js guide under `node_modules/next/dist/docs/` before relying on framework APIs or conventions.

Keep the primary thread on GPT-5.6 Sol for delegated work in Codex. In Cursor, keep the primary thread on Grok 4.6; use Grok 4.6 for ordinary code review; auto-call Fable 5 via `cdas-reviewer` only on protected-invariant must-call gates. The primary thread owns scope, product and domain decisions, authorization boundaries, accepted task contracts, integration, and final verification. If the runtime cannot confirm a requested model, report the model as unknown instead of claiming that routing succeeded.

For Cursor model routing, cheap-model exceptions, Fable 5 review gates, and subagent defaults, read [references/cursor-routing.md](references/cursor-routing.md).

## Ship At The Right Depth

Default to delivery over exhaustive hardening. Fix P0/P1 (or T0/T1), authorization and data-integrity risks, and issues that block the accepted user journey, build, deployment, or required acceptance run. Put P2/T2 compatibility edges, polish, speculative hardening, and optional test completeness into a concise backlog unless the user explicitly raises their priority.

Do not open another implementation, review, or remote-retry cycle solely for a non-blocking finding. For a small low-risk change, let the primary thread implement it and run focused checks. Use independent review or duplicated full verification only for substantial slices, protected invariants, or ambiguous blocking failures. One review pass is the default; re-review only a blocking fix or a material risk-surface change.

## Decide Whether To Delegate

Handle the task directly when it is small, follows one ordered reasoning chain, or would make agents contend over the same mutable files. Delegate only independent, bounded work that materially improves speed, coverage, or context focus.

Prefer these project agents:

- `cdas_explorer` / `cdas-explorer`: read-only code and documentation mapping.
- `cdas_builder` / `cdas-builder`: one accepted implementation slice with explicit file ownership.
- `cdas_reviewer` / `cdas-reviewer`: independent read-only correctness and invariant review.
- `cdas_verifier` / `cdas-verifier`: focused checks and failure-evidence collection without source edits.

Codex maps explorer and verifier to Luna, builder and reviewer to Terra, with Sol as coordinator. Cursor maps the primary thread and builder to Grok 4.6, explorer and verifier to Composer 2.5 `[fast=false]`, ordinary review to Grok 4.6, and automatic protected-invariant review to Fable 5.

Keep delegation one level deep. Subagents must not spawn more agents. Run at most three subagents concurrently, and never run two source-code writers at the same time.

## Orchestrate Substantial Work

1. Define an implementation card containing the objective, protected invariants, allowed and forbidden files, non-goals, acceptance scenarios, validation commands, required evidence, and escalation conditions.
2. Use read-only agents in parallel when code mapping, framework verification, or test-gap analysis are independent. Wait for their evidence before accepting an implementation plan.
3. Use at most one `cdas_builder` after the plan and file ownership are fixed. Do not let the builder resolve an unspecified product or domain decision.
4. After substantial or protected-invariant implementation, run `cdas_reviewer` and `cdas_verifier` in parallel when their scopes do not overlap. For small low-risk edits, use focused primary-thread checks instead. The primary thread must inspect the actual diff and command results itself.
5. Reconcile blocking recommendations as adopted, partially adopted, or rejected. Record P2/T2 findings as backlog without reopening the slice unless the user asks. The primary thread performs final acceptance and reports material residual risk.

Prefer the primary Sol thread as the sole writer for authorization, resource ownership, Prisma schema or migrations, database invariants, `ActionIntent`, idempotency, `AgentRun` provenance, append-only business history, and shared UI/Agent domain commands. A Terra builder may touch these areas only after the primary thread has fixed the exact invariant, file scope, negative tests, and transaction boundary.

Never allow a subagent to commit, push, deploy, run a production migration, change credentials, or perform another external side effect unless the user separately authorizes that action.

On a `codex/*` branch, the primary thread must `git push` to origin after committing accepted work so Vercel Preview and GitHub CI stay in sync. That push is standing owner authorization for this development branch, not a per-session exception. `pnpm development:infra` still needs a clean, already-pushed HEAD and is not a substitute for the push.

For concrete task envelopes, return contracts, escalation triggers, and verification gates, read [references/orchestration.md](references/orchestration.md).

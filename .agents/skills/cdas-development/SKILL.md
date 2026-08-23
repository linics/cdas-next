---
name: cdas-development
description: Coordinate substantial CDAS Next feature, bug-fix, refactor, and review work with bounded Sol-led subagents while preserving product, domain, authorization, history, and acceptance-test invariants. Use for work that benefits from parallel exploration or independent verification; skip for small, ordered tasks where delegation adds overhead.
---

# CDAS Development

Use this skill only for the development workflow. It must not add a multi-Agent layer to the CDAS product runtime.

## Ground The Work

Before changing business behavior, read `PRODUCT.md`, `DOMAIN.md`, `ACCEPTANCE.md`, and `AGENT.md`. Read the relevant installed Next.js guide under `node_modules/next/dist/docs/` before relying on framework APIs or conventions.

Keep the primary thread on GPT-5.6 Sol for delegated work. The primary thread owns scope, product and domain decisions, authorization boundaries, accepted task contracts, integration, and final verification. If the runtime cannot confirm a requested model, report the model as unknown instead of claiming that routing succeeded.

## Decide Whether To Delegate

Handle the task directly when it is small, follows one ordered reasoning chain, or would make agents contend over the same mutable files. Delegate only independent, bounded work that materially improves speed, coverage, or context focus.

Prefer these project agents:

- `cdas_explorer`: Luna, read-only code and documentation mapping.
- `cdas_builder`: Terra, one accepted implementation slice with explicit file ownership.
- `cdas_reviewer`: Terra, independent read-only correctness and invariant review.
- `cdas_verifier`: Luna, focused checks and failure-evidence collection without source edits.

Keep delegation one level deep. Subagents must not spawn more agents. Run at most three subagents concurrently, and never run two source-code writers at the same time.

## Orchestrate Substantial Work

1. Define an implementation card containing the objective, protected invariants, allowed and forbidden files, non-goals, acceptance scenarios, validation commands, required evidence, and escalation conditions.
2. Use read-only agents in parallel when code mapping, framework verification, or test-gap analysis are independent. Wait for their evidence before accepting an implementation plan.
3. Use at most one `cdas_builder` after the plan and file ownership are fixed. Do not let the builder resolve an unspecified product or domain decision.
4. After implementation, run `cdas_reviewer` and `cdas_verifier` in parallel when their scopes do not overlap. The primary thread must inspect the actual diff and command results itself.
5. Reconcile every returned recommendation as adopted, partially adopted, or rejected. The primary thread performs final acceptance and reports residual risk.

Prefer the primary Sol thread as the sole writer for authorization, resource ownership, Prisma schema or migrations, database invariants, `ActionIntent`, idempotency, `AgentRun` provenance, append-only business history, and shared UI/Agent domain commands. A Terra builder may touch these areas only after the primary thread has fixed the exact invariant, file scope, negative tests, and transaction boundary.

Never allow a subagent to commit, push, deploy, run a production migration, change credentials, or perform another external side effect unless the user separately authorizes that action.

For concrete task envelopes, return contracts, escalation triggers, and verification gates, read [references/orchestration.md](references/orchestration.md).

# CDAS Development — Cursor Model Routing

Use this reference when working in Cursor. Codex routing (Sol / Luna / Terra) remains in `.codex/agents/` for Codex sessions.

## Budget posture

This project has a short development window (~7 days). Prefer Grok 4.6 liberally for speed and quality. Reserve roughly 30% of the monthly Cursor allowance for non-project work later in the billing cycle, but do not under-delegate to save tokens when parallel subagents materially help.

## Pool rules

| Pool | Models | Use for |
|------|--------|---------|
| **Cursor Models** | Grok 4.6, Grok 4.5, Composer 2.5 | All primary work and most subagents |
| **Other Models** | Claude Fable 5 only | Expert review via `cdas-reviewer` |

Do not spend the Other Models pool on GPT, Opus, Terra, or Sol unless the user explicitly overrides this routing for a session.

## Default routing

| Role | Agent | Model | When |
|------|-------|-------|------|
| Primary coordinator | main thread | **Grok 4.6** | scope, domain decisions, integration, final acceptance |
| Explorer | `cdas-explorer` | **Grok 4.6** | read-only mapping before implementation |
| Builder | `cdas-builder` | **Grok 4.6** | one accepted implementation slice |
| Verifier | `cdas-verifier` | **Grok 4.6** | assigned checks and failure evidence |
| Expert reviewer | `cdas-reviewer` | **Fable 5** | post-implementation or high-risk invariant review |

Subagents still spawn when the skill calls for them. Use another Grok 4.6 subagent rather than doing everything inline when exploration, verification, or parallel read work is independent.

## Cheap-model exception

Use **Composer 2.5 Fast** or **Grok 4.5** only for clearly batch, repetitive, low-judgment work, such as:

- wide but shallow file/symbol sweeps with a fixed checklist;
- formatting or import cleanup across many files with no behavior change;
- running a known command matrix and collecting stdout.

Do not use cheap models for domain commands, authorization, Prisma, transactions, append-only history, or acceptance-scenario changes.

## Fable 5 review gates

Invoke `cdas-reviewer` at these points:

1. After a substantial feature slice or multi-file domain change that carries P0/P1 or protected-invariant risk, before final acceptance.
2. Before accepting changes touching authorization, resource ownership, Prisma schema or migrations, idempotency, or append-only history.
3. When a subagent reports conflicting evidence or escalation to the primary thread.
4. When resuming unfinished work from Codex and the diff scope is non-trivial.

Skip Fable 5 for tiny, low-risk edits with no invariant surface. P2/T2-only findings are a compact backlog item and do not trigger another Fable review or implementation cycle.

## Escalation unchanged

Model routing does not relax any invariant from `AGENTS.md`, `DOMAIN.md`, or `ACCEPTANCE.md`. Escalation rules in [orchestration.md](orchestration.md) still apply.

If the runtime cannot confirm the requested model, record it as unknown instead of claiming routing succeeded.

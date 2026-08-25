# CDAS Development — Cursor Model Routing

Use this reference when working in Cursor. Codex routing (Sol / Luna / Terra) remains in `.codex/agents/` for Codex sessions.

## Budget posture

This project has a short development window (~7 days). Keep **Grok 4.6 on the primary thread and builder** — coordination and implementation must not fall onto a cheap Auto path. Explorer and verifier use Composer so parallel read/verify work does not burn 4.6 capacity. Reserve roughly 30% of the monthly Cursor allowance for non-project work later in the billing cycle, but do not under-delegate when parallel subagents materially help.

If Grok 4.6 returns High Load / `resource_exhausted`, retry briefly or use **Grok 4.6 Fast** for primary/builder; do not switch those roles to Auto Cost/Balance or Composer.

## Pool rules

| Pool | Models | Use for |
|------|--------|---------|
| **Cursor Models** | Grok 4.6 (primary + builder), Composer 2.5 (explorer + verifier) | Graded Cursor work |
| **Other Models** | Claude Fable 5 only | Expert review via `cdas-reviewer` |

Do not spend the Other Models pool on GPT, Opus, Terra, or Sol unless the user explicitly overrides this routing for a session. Prefer **standard** Composer over Composer Fast for explorer/verifier unless the user asks otherwise.

## Default routing (gradient)

| Role | Agent | Model | When |
|------|-------|-------|------|
| Primary coordinator | main thread | **Grok 4.6** | scope, domain decisions, integration, final acceptance |
| Builder | `cdas-builder` | **Grok 4.6** | one accepted implementation slice |
| Explorer | `cdas-explorer` | **Composer 2.5** | read-only mapping before implementation |
| Verifier | `cdas-verifier` | **Composer 2.5** | assigned checks and failure evidence |
| Expert reviewer | `cdas-reviewer` | **Fable 5** | post-implementation or high-risk invariant review |

Subagents still spawn when the skill calls for them. Explorer and verifier stay on Composer; do not pin them to Grok 4.6.

## Domain-sensitive work

Grok 4.6 builder may implement an accepted card that touches domain commands, authorization, Prisma, transactions, append-only history, or acceptance scenarios **only after** the primary thread has fixed the exact invariant, file scope, negative tests, and transaction boundary in the card. Unresolved product or domain decisions escalate to the Grok 4.6 primary.

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

# CDAS Development — Cursor Model Routing

Use this reference when working in Cursor. Codex routing (Sol / Luna / Terra) remains in `.codex/agents/` for Codex sessions.

## Budget posture

This project has a short development window (~7 days). Keep **Grok 4.6 on the primary thread and builder** — coordination and implementation must not fall onto a cheap Auto path. Explorer and verifier use **standard** Composer (never Fast) so parallel read/verify work does not burn 4.6 capacity. Reserve roughly 30% of the monthly Cursor allowance for non-project work later in the billing cycle, but do not under-delegate when parallel subagents materially help.

If Grok 4.6 returns High Load / `resource_exhausted`, retry briefly or use **Grok 4.6 Fast** for primary/builder; do not switch those roles to Auto Cost/Balance or Composer.

**Never** spawn explorer/verifier as Composer Fast or Grok 4.5 Fast. Pin standard Composer with `composer-2.5[fast=false]` — bare `composer-2.5` may resolve to Fast and bill ~2.5× on output.

## Pool rules

| Pool | Models | Use for |
|------|--------|---------|
| **Cursor Models** | Grok 4.6 (primary + builder + ordinary review), Composer 2.5 standard (explorer + verifier) | Almost all Cursor work |
| **Other Models** | Claude Fable 5 only, and **only on must-call gates** | Protected-invariant expert review |

Do not spend the Other Models pool on GPT, Opus, Terra, Sol, or routine diff review unless the user explicitly overrides this routing for a session.

## Default routing (gradient)

| Role | Agent | Model | When |
|------|-------|-------|------|
| Primary coordinator | main thread | **Grok 4.6** | scope, domain decisions, integration, final acceptance |
| Builder | `cdas-builder` | **Grok 4.6** | one accepted implementation slice |
| Explorer | `cdas-explorer` | **Composer 2.5 `[fast=false]`** | read-only mapping before implementation |
| Verifier | `cdas-verifier` | **Composer 2.5 `[fast=false]`** | assigned checks and failure evidence |
| Ordinary code review | primary (or brief Grok 4.6 read-only pass) | **Grok 4.6** | default second-pass on diffs |
| Expert invariant review | `cdas-reviewer` | **Fable 5** | automatic, only on must-call gates below |

Subagents still spawn when the skill calls for them. Explorer and verifier stay on standard Composer; do not pin them to Grok 4.6.

## Domain-sensitive work

Grok 4.6 builder may implement an accepted card that touches domain commands, authorization, Prisma, transactions, append-only history, or acceptance scenarios **only after** the primary thread has fixed the exact invariant, file scope, negative tests, and transaction boundary in the card. Unresolved product or domain decisions escalate to the Grok 4.6 primary.

## Review split: Grok 4.6 vs Fable 5

### Ordinary review → Grok 4.6 (default)

After a normal implementation slice, the Grok 4.6 primary reviews the actual diff (or runs a short Grok 4.6 read-only pass). Do **not** route ordinary review to Codex, Composer, or Fable.

### Fable 5 must-call gates (automatic — no user prompt)

Call `cdas-reviewer` **automatically** when the accepted, about-to-be-accepted, or just-implemented slice **materially changes** any of these. The user should not have to watch the screen or say “use Fable”.

| # | Must call Fable 5 when the slice changes… | Why Grok alone is not enough |
|---|-------------------------------------------|------------------------------|
| 1 | **Authorization / resource ownership / membership** on a server command or query path | Wrong allow/deny is a silent security failure; needs an independent second model |
| 2 | **Prisma schema, migrations, DB triggers, or transaction boundaries** (what sits inside vs outside a transaction; external I/O in a transaction) | Data-integrity / rollback hazards are easy to miss in the same thread that designed the change |
| 3 | **Append-only business history, idempotency, confirmation, audit, or AgentRun provenance** | History corruption is irreversible; independent check before accept |
| 4 | **UI action and Agent tool no longer share the same domain command** on a path that already had command parity | Split write paths recreate the core product invariant failure mode |

**One Fable pass per qualifying slice.** Do not re-open Fable for P2/T2 cleanup on the same slice.

### Do not call Fable 5 when

- Docs, staging scripts, fixtures, CSS/copy, or pure test refactors with no invariant surface
- Feature work that only consumes existing commands without changing auth, schema, history, or command parity
- Explorer/verifier disagreement — Grok 4.6 primary reconciles
- Ordinary “does this diff look sane” review — Grok 4.6 primary
- The user did not ask, and none of the four must-call rows match

If a must-call Fable run fails (quota / provider error), report the failure and residual risk in the primary acceptance note; do not silently skip without saying so, and do not burn retries that only restate the same review.

## Escalation unchanged

Model routing does not relax any invariant from `AGENTS.md`, `DOMAIN.md`, or `ACCEPTANCE.md`. Escalation rules in [orchestration.md](orchestration.md) still apply.

If the runtime cannot confirm the requested model, record it as unknown instead of claiming routing succeeded.

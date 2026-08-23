# CDAS Development Orchestration

Read this reference when the current task is substantial enough to delegate.

## Implementation Card

Give every delegated task a bounded envelope:

```text
Role:
Objective:
Protected invariants:
Allowed files:
Forbidden files:
Relevant evidence:
Non-goals:
Acceptance scenarios:
Verification commands:
Required output:
Stop or escalation conditions:
```

Do not delegate an unresolved product decision. If the allowed files overlap another active writer, serialize the tasks or change ownership before spawning.

## Agent Return Contract

Require concise, evidence-based results:

```text
Status: complete | partial | blocked
Files inspected:
Files changed:
Evidence:
Commands and exit codes:
Acceptance coverage:
Risks or uncertainty:
Escalation needed:
```

Treat a role name or requested model as intent, not proof. Use runtime agent metadata when available. If the runtime does not expose the actual model, record it as unknown.

## Escalation

Escalate Luna work to Terra when the task stops being narrow or repeatable, crosses several modules, needs non-trivial implementation judgment, or produces conflicting evidence.

Escalate Terra work to the primary Sol thread when it reveals:

- a missing or contradictory product, domain, Agent, or acceptance decision;
- authentication, authorization, membership, or resource-ownership ambiguity;
- a change to append-only history, idempotency, confirmation, audit, or provenance;
- a Prisma schema, migration, database trigger, or transaction-boundary decision;
- overlapping file ownership or an unexpected dirty-worktree conflict;
- failed verification whose cause is not local to the assigned slice.

Stop rather than expanding scope when escalation would require new user authority or an external side effect.

## Verification Gates

For ordinary application changes, run the focused relevant tests, then:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For Prisma, domain-command, transaction, or database-invariant changes, also run:

```sh
pnpm db:validate
pnpm db:test:deploy
pnpm db:test
pnpm test:db
pnpm db:test:diff
pnpm audit:prod
```

Database integration tests are not a substitute for the ordinary test suite. Match every behavior or invariant change to the relevant scenario in `ACCEPTANCE.md` in the same change.

## Final Acceptance

The primary thread must verify the actual diff and explicitly check:

- resource-level authorization, not role-only checks;
- UI and Agent paths call the same domain commands;
- published releases, submissions, feedback, audits, and successful idempotency results remain append-only;
- no model, authentication-provider, or object-storage call occurs inside a database transaction;
- normal, unauthorized, missing-or-concurrent, repeated, and external-failure paths are covered proportionally to risk;
- AI unavailability does not break the core teacher-student workflow.

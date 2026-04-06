---
description: End-of-phase checklist and audit
argument-hint: "[phase-number (1-6)]"
---

End-of-phase checklist for phase $ARGUMENTS. Run before moving to the next phase.

Steps:
1. Read `SPEC.md` — verify every user story in this phase has a matching implementation
2. Read `task.md` — confirm all tasks for this phase are checked off
3. Run `/check` — lint, typecheck, and tests must all pass
4. Audit documentation:
   - `PLAN.md` is up to date with what was actually built (no stale architecture decisions)
   - `task.md` has no tasks left unchecked for this phase
5. Code hygiene check:
   - No `TODO` or `FIXME` comments in committed code (convert to `task.md` entries)
   - No `console.log` or debug statements left in `src/`
   - No TypeScript `any` casts introduced
   - No commented-out code blocks
6. Report:
   - Stories implemented vs total for this phase
   - Open issues found (create new tasks in `task.md` for each)
   - Explicit sign-off or list of blockers before the next phase begins

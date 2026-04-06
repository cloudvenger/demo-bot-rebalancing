# AI-Assisted Development Workflow — Reference

This directory contains the full workflow reference, split by phase and topic.

## Phases

| Phase | File | Condition |
|---|---|---|
| 1 — Ideation | [phase1-ideate.md](workflow/phase1-ideate.md) | Always |
| 2 — Design | [phase2-design.md](workflow/phase2-design.md) | If using Paper or Pencil |
| 3 — Architecture | [phase3-architect.md](workflow/phase3-architect.md) | Always |
| 4 — Build | [phase4-build.md](workflow/phase4-build.md) | Always |
| 5 — Validation | [phase5-validate.md](workflow/phase5-validate.md) | Always |
| 6 — Ship | [phase6-ship.md](workflow/phase6-ship.md) | Always |

## Topics

- [Design — Brownfield](workflow/design-brownfield.md) — modifying an existing app: audit, component mapping, scoped changes, round-trip screenshot verification
- [Git Strategy](workflow/git-strategy.md) — trunk-based development rules
- [Iteration & Re-entry](workflow/iteration.md) — how the loop restarts for new features
- [CLI Patterns](workflow/cli-patterns.md) — background processes, watch modes, parallel tasks
- [Extending the Workflow](workflow/extending.md) — custom skills, new agent roles, stack adaptation
- [Modes](workflow/modes.md) — Full, Sprint, Micro operating modes
- [Handoff Templates](workflow/handoff-templates.md) — Task assignment, QA PASS/FAIL, escalation
- [Persistent Memory](workflow/memory.md) — MCP memory setup, agent memory contract, cross-session continuity

## Quick command reference

| Command | Phase | What it does |
|---|---|---|
| `/help` | Any | Full workflow overview for new users |
| `/ideate` | 1 | Interactive ideation → produces SPEC.md (Claude Code alternative to Antigravity) |
| `/design-draft` | 2 (optional) | Generate rough Stitch drafts from SPEC.md → `designs/drafts/` as reference for `/design-screens` |
| `/plan` | 3 | Explore subagent + PLAN.md + tagged task.md |
| `/build` | 4 | Route tagged tasks to team agents in parallel |
| `/check` | 4–5 | Quality gate: lint + typecheck + tests |
| `/validate` | 5 | Parallel QA + security + visual subagents |
| `/ship` | 6 | Commit + push + open PR |

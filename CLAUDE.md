# Project Context — AI-Assisted Development Workflow

## What is this project?
This repo demonstrates and applies a state-of-the-art AI-assisted development workflow.
Full workflow reference: [docs/workflow.md](docs/workflow.md)

---

## Workflow Phases (summary)
1. **Ideate** — Antigravity or `/ideate` produces `SPEC.md`
2. **Design** — Paper MCP produces `designs/*.paper` screen files
3. **Architect** — Claude Code Plan mode produces `PLAN.md`
4. **Build** — Claude Code + Subagents + Skills implement features
5. **Validate** — QA Agent runs tests and patches failures
6. **Ship** — `/commit` → `/review-pr` → PR → CI/CD

---

## Key Files
| File | Purpose |
|---|---|
| `SPEC.md` | Product spec (from Antigravity or `/ideate`) — source of truth for requirements |
| `PLAN.md` | Technical architecture and task breakdown |
| `task.md` | Granular task checklist, updated as work progresses |
| `designs/*.paper` | Paper design files — source of truth for UI |
| `backend/CLAUDE.md` | Backend agent context |
| `frontend/CLAUDE.md` | Frontend agent context |
| `contracts/CLAUDE.md` | Smart contracts agent context |

---

## Stack
> To be filled after Phase 1 (Antigravity) and Phase 3 (scaffolding).

- **Framework**: TBD
- **Database**: TBD
- **Auth**: TBD
- **Testing**: TBD
- **Styling**: TBD

---

## Agent Rules
- Always read `SPEC.md` and `PLAN.md` before starting any new feature
- Always read relevant `CLAUDE.md` files for the layer you are working in
- For UI work: open the Paper design and read the relevant node via Paper MCP tools before coding
- **Never commit directly to `main`** — every codebase change must go through a branch → PR → merge flow
- Create a branch before writing any code, open a PR when done, and only merge after human approval
- Never run destructive git operations without user confirmation
- When a task is complete, update `task.md` to mark it done
- Keep changes scoped — do not refactor unrelated code while implementing a feature
- **Ask the user rather than guess** when requirements are unclear — do not assume intent

For branching conventions and PR rules: @docs/workflow/git-strategy.md

---

## Conventions & Quality

> Coding conventions, security checklist, and test rules auto-load from `.claude/rules/` each session.
> Hooks in `.claude/hooks/` enforce: no commits to main, no debug statements, no hardcoded secrets.

---

## Available Skills

Run `/help` for an interactive overview of all commands, phases, and modes.
Full skill reference: @docs/workflow/cli-patterns.md

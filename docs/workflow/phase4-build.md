# Phase 4 — Build

**Tools: Claude Code + Skills + Subagents + Team Agents**

This is the core implementation loop. It runs iteratively for each feature until all tasks in `task.md` are complete.

## The build loop
```
/build                      → reads task.md, groups tasks, spawns parallel subagents
  └─> Group 1 (parallel): independent tasks run simultaneously
        ├─> Backend Agent: API route + DB
        ├─> Frontend Agent: Component from design
        └─> QA Agent: write tests alongside
  └─> Group 2 (sequential): tasks with dependencies wait for their group
  └─> Mark tasks done in task.md after each group
  └─> /check (lint, typecheck, tests)
/ship                       → commit, push, open PR
```

Run `/build` to execute the full loop automatically. See the skill for the exact orchestration logic.

## Subagents — parallel execution
Subagents run as independent processes. Use them to parallelize work that does not depend on each other:

```
Main Agent (orchestrator)
  ├── Subagent A: Implement POST /users endpoint
  ├── Subagent B: Build UserCard component from the Paper design
  └── Subagent C: Write test suite for auth module
```

Each subagent reads the shared context files (`CLAUDE.md`, `SPEC.md`, `PLAN.md`) before starting.

## Team Agents — role-specific context
Persistent agent roles are encoded in per-directory `CLAUDE.md` files:

| Agent | Reads | Knows |
|---|---|---|
| Backend Agent | `backend/CLAUDE.md` | API conventions, DB schema, auth patterns |
| Frontend Agent | `frontend/CLAUDE.md` + Paper design | Component rules, design tokens, state patterns |
| Contracts Agent | `contracts/CLAUDE.md` | Solidity conventions, storage layout, security patterns |
| QA Agent | all CLAUDE.md files | Test framework, coverage expectations |

## Skills — repeatable tasks as commands
Skills are markdown files in `.claude/skills/` that encode a workflow as a slash command.

**Workflow rituals** — run at task boundaries:
| Command | Use case |
|---|---|
| `/new-feature <task>` | Start every task: sync main, create branch, load context |
| `/build` | Run the full build loop: group tasks, spawn parallel subagents, quality gate |
| `/check` | Quality gate only: lint, typecheck, unit tests |
| `/ship` | End every task: check, commit, push, open PR |
| `/review-phase <number>` | End-of-phase checklist before moving to the next phase |

**Implementation** — generate code from spec and design:
| Command | Use case |
|---|---|
| `/gen-component <name>` | Build a UI component from the Paper design |
| `/gen-animation <name>` | Build an animated component from Paper motion annotations |
| `/gen-api-route <method> <path>` | Build an API route with validation + tests |
| `/gen-contract <name>` | Generate a Solidity contract with tests |
| `/add-test <file>` | Write a test suite for any file |

## Task sizing — keep tasks small

AI agents perform best on tightly scoped, single-concern tasks. Vague multi-file tasks lead to hallucinations, missed edge cases, and tangled diffs. The rule is: **if you can't describe a task in one sentence, it's too big.**

**Good task size (one agent session):**
- "Create `POST /api/v1/users` endpoint with validation"
- "Build `UserCard` component from Paper design node"
- "Write unit tests for the `auth.service.ts` module"
- "Add password reset email template"

**Too big — break it down:**
- "Build the auth system" → split into: signup endpoint, login endpoint, JWT middleware, password reset, session management
- "Create the dashboard" → split into: layout shell, stats cards, chart component, data fetching hook, API route

**Sizing rules:**
- One task = one file, one endpoint, or one component
- If a task touches more than 3 files, it should be split
- If a task takes more than one agent session, it's too broad
- Each task must be independently testable

## Animation implementation
When a component has motion annotations in the Paper design:
1. Use `/gen-animation <ComponentName>` to scaffold the animated version
2. The skill reads the design node, extracts the motion annotations, and produces the GSAP + Lenis code
3. All animations must follow the conventions in `frontend/CLAUDE.md` (easing table, `useGSAP()`, `prefers-reduced-motion`)
4. Lenis is initialized once at app root (`lib/motion.ts`) — never per component

Animation tasks follow the same sizing rule: one animation task = one component or one page transition.

## Common patterns

### Fixing a bug
1. Write a test that reproduces the bug (proves it exists before fixing)
2. Fix the code
3. Verify the new test passes
4. Run the full test suite — confirm no regressions
5. Run lint; check no new warnings introduced

### Modifying existing code
1. Run tests before making changes to establish a baseline
2. Make minimal, targeted changes
3. Run tests after — if broken, revert and approach differently

---

## Build conventions
- **Every task starts with a branch** — create it before writing any code (`git checkout -b feat/task-name`)
- **Every task ends with a PR** — push the branch, open a PR, wait for human approval, then merge
- Never commit directly to `main`, even for trivial changes
- Every feature branch should map to one user story in `SPEC.md`
- Tasks in `task.md` are marked done immediately after completion
- No TODO comments in code — if something is deferred, it becomes a new task in `task.md`
- Lint and type-check must pass before marking any task complete

## Deliverable
All tasks in `task.md` checked off, lint and type-check passing, each feature has tests.

## Intra-phase iteration
```
Implement task → test fails → fix → test passes → next task
```

---

## Exit Gate — Phase 4 → 5

| Criterion | Threshold | How to verify |
|---|---|---|
| All tasks complete | 0 unchecked `- [ ]` lines | `grep -c "\- \[ \]" task.md` returns 0 |
| No blocked tasks | 0 `[blocked:` annotations | `grep "\[blocked" task.md` returns nothing |
| `/check` passes | 0 lint errors, 0 type errors, 0 test failures | Run `/check` — all three commands exit 0 |
| No TODO comments in new code | 0 TODOs | `grep -r "TODO" src/` |
| Human has reviewed the diff | Approval before Phase 5 | Human reviews changed files |

Gate fails → return to build loop, fix blockers, re-run `/check`.

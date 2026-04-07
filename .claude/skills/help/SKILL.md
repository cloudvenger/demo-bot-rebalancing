---
description: Workflow overview — modes, phase loop, commands, task tags, exit gates, handoff templates, and escalation
---

# /help — Workflow Overview

Welcome to the AI-assisted development workflow. Here is everything you need to know to start building.

---

## Choose Your Mode

There is no command to activate a mode. A mode is simply a sequence of skills you run based on scope.

| Mode | Use when | Skill sequence |
|---|---|---|
| **Full** | New project from scratch | `/ideate` → `/plan` → `/build` → `/validate` → `/ship` |
| **Sprint** | Adding a feature to an existing project | `/new-feature` → `/plan` → `/build` → `/validate` → `/ship` |
| **Micro** | Single targeted change (≤ 3 files) | `/new-feature` → `gen-api-route` \| `gen-contract` \| `add-test` → `/check` → `/ship` |

**Decision shortcut:** default to Sprint for features, Micro for fixes, Full for new projects.

### How to describe your task — by mode

**Full** — start with ideation, then architect:
```
/ideate "a backend bot that rebalances a Morpho Vault V2 across Blue markets"
  → asks 5 discovery questions, drafts SPEC.md, asks for review, writes file on approval

/plan    ← reads SPEC.md, produces PLAN.md + task.md
/build
```

**Sprint** — if your feature is not yet in `SPEC.md`, append a user story before `/plan`:
```
# In SPEC.md, add a section like:
## Feature: dry-run mode
As an operator, I want to simulate rebalances without submitting transactions.
Acceptance: dry-run flag in config, executor returns simulated result.

/new-feature "dry-run-mode"
/plan    ← reads the new SPEC.md section, scopes the plan to it
/build
```

**Micro** — no SPEC.md, PLAN.md, or task.md needed. The argument to `/new-feature` is the task.

*Fixing or modifying something that exists* (bug fix, config tweak, log change):
```
/new-feature "fix gas ceiling check on empty market list"
# Describe the change — Claude reads the file, edits it, confirms the change is correct.
# Bug fix? If no test covers this path → /add-test before /check.
/check
/ship
```

*Creating a new artifact* (new route, new contract, new test):
```
/new-feature "add rebalance status endpoint"
/gen-api-route GET /api/v1/rebalance/status
/check
/ship
```

Use `gen-*` only when creating something from scratch. For edits and fixes, just describe the change — no skill needed.

After any edit, quick self-check: solves the problem? change is minimal? test coverage exists?

Do not use `/build` — it requires `task.md`, which Micro mode never creates.

Full reference: [docs/workflow/modes.md](../../docs/workflow/modes.md)

---

## The Phase Loop

```
Phase 1: Ideate    → SPEC.md              (/ideate)
Phase 2: Architect → PLAN.md + task.md   (/plan)
Phase 3: Build     → codebase            (/build)
Phase 4: Validate  → walkthrough.md      (/validate)
Phase 5: Ship      → merged PR           (/ship)
```

Each phase produces one artifact. The next phase cannot start without it.

---

## Commands — in order of use

### Phase 1 — Ideation
```
/ideate "your idea or problem description"
```
Runs an interactive discovery session inside Claude Code. Asks 5 targeted questions (batched in one message), drafts a complete `SPEC.md`, shows you the draft for review, and writes the file when you approve.

---

### Starting a session (Sprint / Micro)
```
/new-feature "task name"
```
Syncs `main`, creates a feature branch, loads all context files. Run this before writing any code.

---

### Phase 2 — Architecture
```
/plan
```
1. Spawns an Explore subagent to scan the existing codebase
2. Reads `SPEC.md`
3. Writes `PLAN.md` (stack, architecture, data models, API contract)
4. Writes `task.md` — one checkbox per task, each tagged with a team agent

---

### Phase 3 — Build
```
/build
```
Reads `task.md`, groups tasks by tag and independence, and spawns parallel subagents:
- `[backend]` tasks → Backend Agent (reads `backend/CLAUDE.md`)
- `[contracts]` tasks → Contracts Agent (reads `contracts/CLAUDE.md`)
- `[qa]` tasks → QA Agent (runs after the task they test)

Marks tasks `[x]` as each group completes. Runs `/check` when done.

**Strict mode** (optional — for auth/payments/critical features):
```
/build --strict
```
Validates each task with qa-runner before moving to the next. Default parallel mode is unchanged — `--strict` is always opt-in.

**Blocked tasks:** if a task fails 3 retries, `/build` emits Template 4 (Escalation) from `docs/workflow/handoff-templates.md` and annotates `task.md` with `[blocked: reason]`. A phase with blocked tasks cannot pass its exit gate — human decision required.

**Handoff templates** (`docs/workflow/handoff-templates.md`) are 4 copy-pasteable formats used by agents to communicate: Template 1 assigns a task, Template 2 reports PASS, Template 3 reports FAIL with fix instructions, Template 4 escalates after 3 retries. You won't write them manually — `/build` and `qa-runner` emit them automatically in strict mode.

```
/check
```
Quality gate: lint + typecheck + tests. Run before any commit.

---

### Phase 4 — Validate
```
/validate
```
Spawns parallel subagents:
- **QA**: runs full test suite, patches failures
- **Security**: checks auth, injection, secrets, gas ceilings, RPC/key exposure

Generates `walkthrough.md` as its output.

---

### Phase 5 — Ship
```
/ship
```
Runs `/check`, commits, pushes the branch, opens the PR. Merge after human review + CI green.

The PR body follows the template in `.github/PULL_REQUEST_TEMPLATE.md` — automatically pre-filled when opening PRs via GitHub.

---

### End-of-phase audit
```
/review-phase 3
```
Checklist to run before moving to the next phase. Pass the phase number.

---

## Implementation commands

Use these at any point during `/build`:

| Command | What it generates |
|---|---|
| `/gen-api-route POST /api/v1/rebalance` | Fastify route + service layer + Vitest test |
| `/gen-contract VaultAdapter` | Solidity smart contract following project conventions |
| `/add-test src/services/rebalance-service.ts` | Test suite for a specific file |

**For `/gen-contract`:** reads `contracts/CLAUDE.md` for chain, framework, Solidity version, and OpenZeppelin conventions. Generates the contract file, a test file, and deployment script. Always runs `/check` before reporting done.

**For `/gen-api-route`:** reads `backend/CLAUDE.md` for the pattern (Plugin → Service → Core), viem conventions, and auth rules. Generates the route, service layer, and Vitest test. Always runs `/check` before reporting done.

---

## Two-layer architecture — how `/build` routes work

This project has two agent layers that can run in parallel during `/build`:

```
[backend]   tasks → Backend Agent
  reads: backend/CLAUDE.md
  generates: Fastify plugins, services, core strategy, chain reader/executor

[contracts] tasks → Contracts Agent
  reads: contracts/CLAUDE.md
  generates: Solidity contracts, tests, deployment scripts (if needed)
```

Tasks tagged `[contracts]` in `task.md` go to the Contracts Agent. The contracts and backend layers are independent — they can run in parallel.

**Typical task split for a rebalancing feature:**
```
- [ ] [backend]    Add ChainReader.getMarketState() for a market id
- [ ] [backend]    Implement Strategy.computeRebalance() pure function
- [ ] [backend]    Wire RebalanceService orchestration (read → compute → execute → notify)
- [ ] [backend]    Add POST /api/v1/rebalance/trigger route (manual trigger)
- [ ] [qa]         Unit tests for Strategy.computeRebalance() — all scoring branches
- [ ] [qa]         Integration test for POST /api/v1/rebalance/trigger against Anvil fork
```

---

## Task tags — how `/build` knows who does what

`/plan` writes `task.md` with tagged tasks:
```
- [ ] [backend]   Create POST /api/v1/rebalance/trigger endpoint
- [ ] [contracts] Deploy adapter contract (if needed)
- [ ] [qa]        Write tests for POST /api/v1/rebalance/trigger
```

`/build` reads the tag and routes each task to the correct agent with the correct CLAUDE.md context. You never manually assign tasks to agents — the tags do it.

**Rules:**
- One task = one tag. Split if two agents are needed.
- `[qa]` tasks always follow the task they test.

---

## Phase exit gates

Each phase has explicit pass/fail criteria. Do not advance until the gate passes.

| Gate | Key criteria |
|---|---|
| Phase 2 → 3 | No TBDs in CLAUDE.md files, PLAN.md complete, task.md covers all SPEC stories, human approved |
| Phase 3 → 4 | All tasks checked, no `[blocked:]` tasks, `/check` passes, human reviewed diff |
| Phase 4 → 5 | Tests green, zero high-severity security findings, `walkthrough.md` exists and complete |
| Phase 5 → merge | `/check` passes, rebased on `main`, CI green, PR approved by reviewer |

Gate fails → fix the failing criterion, re-run the relevant skill, repeat. Full criteria in each phase doc.

---

## Key files

| File | What it is | Created by |
|---|---|---|
| `SPEC.md` | Product requirements — source of truth | `/ideate` |
| `PLAN.md` | Architecture decisions | `/plan` |
| `task.md` | Tagged task checklist | `/plan` |
| `walkthrough.md` | How to run the app | `/validate` |
| `CLAUDE.md` | Global agent context | Template + `/plan` fills TBDs |
| `backend/CLAUDE.md` | Backend Agent context | Template + `/plan` fills TBDs |
| `contracts/CLAUDE.md` | Contracts Agent context | Template + `/plan` fills TBDs |
| `docs/workflow/modes.md` | Full / Sprint / Micro mode reference | This repo |
| `docs/workflow/handoff-templates.md` | 4 agent communication templates | This repo |
| `docs/workflow/memory.md` | MCP memory setup for cross-session continuity | This repo |
| `docs/workflow/extending.md` | How to add custom skills and agents | This repo |

---

## Extending the workflow

The workflow is designed to be customized. See `docs/workflow/extending.md` for a full guide covering:
- Good vs. bad skill design
- Required sections for every agent SKILL.md
- Stack-specific conventions (Bun, Fastify, viem, Foundry)
- Anti-patterns to avoid

---

## Persistent memory (optional)

For projects that span multiple sessions, set up MCP memory to give agents cross-session continuity. See `docs/workflow/memory.md` for:
- Setup guide (install + MCP config + permissions)
- Memory contract: what each agent writes and when
- Key naming conventions
- Example memory entries

---

## Typical session flow

```
/ideate "morpho vault rebalancer"
  → discovery questions answered
  → SPEC.md written

/new-feature "rebalance-core"
  → main synced, branch created

/plan
  → reads SPEC.md
  → PLAN.md + task.md written
  → exit gate: human approves PLAN.md before build

/build
  → [backend] tasks: Backend Agent builds services, chain reader, strategy
  → [contracts] tasks: Contracts Agent builds adapters (if needed)
  → [qa] tests run after
  → /check passes
  → exit gate: all tasks checked, no blockers

/validate
  → QA: tests green
  → Security: no high findings
  → walkthrough.md written
  → exit gate: human reviews validation report

/ship
  → PR opened
  → CI runs, human approves, merge
```

---

## Where to read more

- `docs/workflow.md` — full phase-by-phase reference and command index
- `docs/workflow/modes.md` — Full, Sprint, Micro modes in detail
- `docs/workflow/extending.md` — add skills, agents, stack conventions (with quality guide)
- `docs/workflow/memory.md` — persistent MCP memory for multi-session projects
- `docs/workflow/handoff-templates.md` — Task assignment, QA PASS/FAIL, and escalation templates
- `README.md` — project overview, tool stack, quick start

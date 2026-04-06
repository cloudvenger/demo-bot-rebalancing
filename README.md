# AI-Assisted Development Workflow

A structured **GitHub template** for building applications using a state-of-the-art AI tool stack. Clone it, run the setup script, and start building with AI agents that share context from day one.

---

## Use This Template

### Option A — New project (from scratch)

Click the **"Use this template"** button on GitHub, or via CLI:

```bash
gh repo create my-app --template cloudvenger/workflow-dev-ia --public --clone
cd my-app
./setup.sh
```

`setup.sh` asks for your project name, which workflow components you need (design, animation, backend, contracts, etc.), and your stack choices. It fills in all `TBD` placeholders and removes any workflow docs or skills that don't apply to your project.

### Option B — Inject into an existing repo

Already have a codebase? Open Claude Code **in this repo** and run:

```
/inject /path/to/your-existing-repo
```

Claude will:
1. Analyse the target repo (detect framework, backend, contracts, existing CLAUDE.md)
2. Ask which modules to inject and confirm detected stack values
3. Intelligently merge any existing `CLAUDE.md` files — preserving project-specific content
4. Write all skills, settings, and layer context files into the target

After injection, open Claude Code in the target repo and run `/help` to verify.

### Create your spec

```bash
cp templates/SPEC.template.md SPEC.md
```

Fill in `SPEC.md` with your product spec (from Antigravity or manually), then start Phase 2.

---

## The Tool Stack

| Tool | Role | Phase |
|---|---|---|
| **Antigravity** | Ideation, product spec, task breakdown | Phase 1 |
| **Paper** | UI/UX design, wireframes, design system | Phase 2 |
| **Claude Code (Plan mode)** | Architecture, Explore subagent, PLAN.md + tagged task.md | Phase 3 |
| **Claude Code (/build)** | Parallel subagents routed to team agents by task tag | Phase 4 |
| **Claude Code (/validate)** | Parallel QA + security + visual regression subagents | Phase 5 |
| **Claude Code Skills** | Repeatable commands (`/gen-component`, `/add-test`, ...) | All phases |

---

## Prerequisites

Install and configure the following before starting:

- **[Claude Code](https://claude.ai/code)** — AI coding CLI (you are likely already in it)
- **[Antigravity](https://antigravity.dev)** — AI ideation and spec tool
- **Paper** — AI design tool with Claude Code MCP integration

---

## Choose Your Mode

| Mode | Use when | Skill sequence |
|---|---|---|
| **Full** | New project from scratch | `/plan` → `/build` → `/validate` → `/ship` |
| **Sprint** | Adding a feature to an existing project | `/new-feature` → `/plan` → `/build` → `/validate` → `/ship` |
| **Micro** | Single targeted change (≤ 3 files) | `/new-feature` → `gen-component` \| `gen-api-route` \| `add-test` → `/check` → `/ship` |

> The Quick Start below is the **Full mode** walkthrough. For Sprint and Micro, see [docs/workflow/modes.md](docs/workflow/modes.md).

---

## Quick Start

> **New to this repo?** Run `/help` in Claude Code for an interactive overview of all commands and concepts.

### Step 1 — Ideate with Antigravity

Open Antigravity, describe your project idea, and let it generate a product specification.

Copy the output and save it as `SPEC.md` at the root of this repo. The file should contain at minimum:
- A problem statement
- User stories (e.g., "As a user, I want to...")
- Acceptance criteria per story
- Technical constraints or preferences

> **Why SPEC.md matters**: every AI agent spawned by Claude Code reads `CLAUDE.md`, which references `SPEC.md`. Without it, agents have no context for *what* they are building.

---

### Step 2 — Design with Paper

Open Claude Code (with Paper app open) and ask it to scaffold screens based on your spec:

```
Read SPEC.md and use the Paper MCP tools to design the main screens.
Apply a fitting style guide and save the result as designs/app.paper.
```

Claude Code will use Paper to:
1. Get design guidelines (`mcp__paper__get_guide`)
2. Create artboards for each screen (`mcp__paper__create_artboard`)
3. Generate screen content incrementally (`mcp__paper__write_html`)
4. Screenshot-verify the result (`mcp__paper__get_screenshot`)

Iterate until the design matches your vision.

---

### Step 3 — Architect with `/plan`

```
/plan
```

Claude Code will:
1. Spawn an **Explore subagent** to scan the existing codebase for patterns and constraints
2. Read `SPEC.md` and all Paper design screens
3. Propose a technical architecture (stack, data models, API contracts, folder structure)
4. Write `PLAN.md` (from `templates/PLAN.template.md`)
5. Update the `TBD` sections in all `CLAUDE.md` files
6. Write `task.md` — one checkbox per task, each tagged with the responsible team agent:
   ```
   - [ ] [backend]   Create POST /api/v1/users endpoint
   - [ ] [frontend]  Build UserCard component from the Paper design
   - [ ] [qa]        Write tests for POST /api/v1/users
   - [ ] [contracts] Deploy Registry contract
   ```

Review and approve the plan before proceeding.

---

### Step 4 — Build with `/build`

```
/new-feature "feature name"   ← sync main, create branch, load context
/build                         ← implement all tasks from task.md
```

`/build` reads the tags in `task.md` and orchestrates parallel subagents automatically:

```
Group 1 (parallel):
  ├── Backend Agent   → reads backend/CLAUDE.md → implements [backend] tasks
  └── Frontend Agent  → reads frontend/CLAUDE.md + Paper design → implements [frontend] tasks

Group 2 (sequential, after Group 1):
  └── QA Agent        → implements [qa] tests for completed tasks

→ marks tasks [x] in task.md after each group
→ runs /check (lint + typecheck + tests) when all done
```

Use implementation skills at any point during the build:

| Command | What it does |
|---|---|
| `/gen-component UserCard` | Generates a UI component from the Paper design node |
| `/gen-animation HeroSection` | Generates a GSAP + Lenis animated component |
| `/gen-api-route POST /users` | Generates an API route with validation and tests |
| `/add-test src/api/users.ts` | Generates a test suite for a specific file |

---

### Step 5 — Validate with `/validate`

```
/validate
```

Spawns 3 parallel subagents:

| Subagent | What it checks |
|---|---|
| **QA** | Runs the full test suite, fixes failing tests |
| **Security** | Auth guards, injection, hardcoded secrets, XSS, CORS |
| **Visual** | Compares running app screens against Paper design screenshots |

Generates `walkthrough.md` documenting how to run the app.

---

### Step 6 — Ship with `/ship`

```
/ship
```

Runs `/check`, commits, pushes, and opens the PR. Merge after human review and CI passes.

---

## Project Structure

```
your-project/
├── README.md                  ← This file
├── CLAUDE.md                  ← Global agent context (auto-read by all agents)
├── setup.sh                   ← Interactive setup script (run once after cloning)
├── add-module.sh              ← Add skipped modules after initial setup
├── .gitignore
│
├── templates/
│   ├── SPEC.template.md       ← Copy to SPEC.md and fill in
│   └── PLAN.template.md       ← Structure for PLAN.md (produced by /plan)
│
├── SPEC.md                    ← Product spec — source of truth for requirements
├── PLAN.md                    ← Architecture — created in Phase 3
├── task.md                    ← Tagged task checklist — created by /plan
├── walkthrough.md             ← Run guide — created by /validate
│
├── designs/
│   └── app.paper              ← Paper design file — created in Phase 2
│
├── docs/
│   ├── workflow.md            ← Workflow TOC (links to phase files below)
│   └── workflow/
│       ├── phase1-ideate.md
│       ├── phase2-design.md
│       ├── phase3-architect.md
│       ├── phase4-build.md
│       ├── phase5-validate.md
│       ├── phase6-ship.md
│       ├── git-strategy.md
│       ├── iteration.md
│       ├── cli-patterns.md
│       ├── extending.md
│       ├── modes.md
│       └── handoff-templates.md
│
├── backend/
│   ├── CLAUDE.md              ← Backend Agent context (API conventions, DB rules, SOLID)
│   └── ...
│
├── frontend/
│   ├── CLAUDE.md              ← Frontend Agent context (component rules, design tokens)
│   └── ...
│
├── contracts/                 ← Optional (removed by setup.sh if not needed)
│   ├── CLAUDE.md              ← Contracts Agent context (Solidity conventions)
│   └── ...
│
└── .claude/
    ├── settings.json          ← Pre-configured permissions (git, Paper MCP, file writes)
    └── skills/                ← Each skill is a subdirectory with SKILL.md
        ├── help/              ← /help    — workflow overview for new users
        ├── new-feature/       ← /new-feature — sync main, create branch, load context
        ├── plan/              ← /plan    — Explore subagent + PLAN.md + tagged task.md
        ├── build/             ← /build   — parallel team agents from task.md tags
        ├── check/             ← /check   — lint + typecheck + tests
        ├── validate/          ← /validate — QA + security + visual subagents
        ├── ship/              ← /ship    — commit, push, open PR
        ├── review-phase/      ← /review-phase — end-of-phase audit checklist
        ├── gen-component/     ← /gen-component — UI component from Paper design
        ├── gen-animation/     ← /gen-animation — animated component (GSAP + Lenis)
        ├── gen-api-route/     ← /gen-api-route — API route with validation + tests
        ├── gen-contract/      ← /gen-contract  — Solidity contract
        └── add-test/          ← /add-test — test suite for any file
```

---

## How CLAUDE.md Files Work

`CLAUDE.md` files are automatically read by Claude Code at the start of every session and every time an agent is spawned. They are the mechanism by which all agents — including subagents running in parallel — share the same context.

```
Root CLAUDE.md        → stack, conventions, links to SPEC + PLAN + designs
backend/CLAUDE.md     → API conventions, DB rules, auth patterns, SOLID
frontend/CLAUDE.md    → component rules, design system reference, state patterns
contracts/CLAUDE.md   → Solidity conventions, storage layout, security patterns
```

When `/build` spawns a subagent, it passes the CLAUDE.md files matching the task's `[tag]`. This is what makes team agents work — each agent has exactly the context it needs, nothing more.

---

## Team Agents

The workflow uses **tagged tasks** in `task.md` to route work to the right agent:

| Tag | Agent | Reads |
|---|---|---|
| `[backend]` | Backend Agent | `CLAUDE.md` + `backend/CLAUDE.md` |
| `[frontend]` | Frontend Agent | `CLAUDE.md` + `frontend/CLAUDE.md` + Paper design node |
| `[contracts]` | Contracts Agent | `CLAUDE.md` + `contracts/CLAUDE.md` |
| `[qa]` | QA Agent | `CLAUDE.md` + CLAUDE.md of the layer being tested |

`/plan` writes the tags. `/build` reads them. You never need to manually route tasks to agents.

---

## Core Principles

1. **Context is the Foundation** — AI agents are only as good as the context they receive. Every agent reads from a shared context layer (`CLAUDE.md` files, `SPEC.md`, `PLAN.md`, and design files).
2. **Phases Produce Deliverables** — Each phase ends with a concrete artifact that the next phase consumes. Do not start a phase without the deliverable from the previous one.
3. **Design and Code Stay in Sync** — The Paper design file is the single source of truth for the UI. Frontend agents read it before writing a component.
4. **Parallelize Aggressively** — Subagents are cheap. Backend and frontend work, test writing, and research can all run simultaneously. Use `/build` to orchestrate this automatically.
5. **Encode Patterns as Skills** — Any task you repeat more than twice should become a Claude Code skill, invocable with a single `/command`.
6. **Humans Approve, Agents Execute** — At the end of every major phase, a human reviews and approves before the next phase begins. Risky actions always require explicit confirmation.

---

## The 6-Phase Loop

```
Ideate → Design → Architect → Build → Validate → Ship
   ↑___________________________________|
         (new features loop back)
```

Each phase produces exactly one artifact that the next phase consumes:

```
Antigravity output  ──→  SPEC.md
SPEC.md             ──→  designs/app.paper       (+ updated frontend/CLAUDE.md)
SPEC.md + designs   ──→  PLAN.md + task.md      (+ updated all CLAUDE.md stack sections)
task.md             ──→  codebase               (features, tests — via /build)
codebase            ──→  walkthrough.md         (validated, secure — via /validate)
walkthrough.md      ──→  deployed app           (via /ship + PR + CI/CD)
```

---

## Validation Checkpoints

What to review before approving each phase and moving to the next:

| Phase | Deliverable | What the human checks |
|---|---|---|
| 1. Ideate | `SPEC.md` | Are user stories clear and testable? Is "out of scope" explicit? |
| 2. Design | `designs/app.paper` | Does every user story have a screen? Are design tokens consistent? |
| 3. Architect | `PLAN.md` + `task.md` | Are stack choices justified? Is the API contract complete? Are tasks tagged correctly? |
| 4. Build | Codebase + tests | Does the code match the design? Do all tests pass? Is `task.md` fully checked off? |
| 5. Validate | `walkthrough.md` | Does the running app match the Paper design screenshots? Is the security audit clean? |
| 6. Ship | PR + CI green | Is the PR description clear? Do all CI checks pass? Is the branch rebased on latest `main`? |

---

## Common Mistakes

| Mistake | Prevention |
|---|---|
| Skipping SPEC.md | Ideation phase is mandatory — agents have no context without it |
| Not filling in CLAUDE.md stack sections | Run `/plan` — it fills TBDs automatically |
| Building UI without reading the Paper design | `/build` routes `[frontend]` tasks through `frontend/CLAUDE.md` which enforces this |
| Missing tags in task.md | `/plan` writes tags — don't write task.md manually |
| Not updating `task.md` as work progresses | `/build` marks tasks done automatically |
| Sequential builds when parallel is possible | `/build` parallelizes automatically based on tags and file independence |
| Skipping tests | Every feature requires at least one `[qa]` task |

---

## Further Reading

- [Workflow reference by phase](docs/workflow.md) — detailed phase guides, git strategy, CLI patterns, iteration model
- Run `/help` in Claude Code for an interactive overview

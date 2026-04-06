---
description: Workflow overview — modes, 6-phase loop, commands, task tags, exit gates, handoff templates, and escalation
---

# /help — Workflow Overview

Welcome to the AI-assisted development workflow. Here is everything you need to know to start building.

---

## Choose Your Mode

There is no command to activate a mode. A mode is simply a sequence of skills you run based on scope.

| Mode | Use when | Skill sequence |
|---|---|---|
| **Full** | New project from scratch | `/ideate` → `/design-screens` → `/plan` → `/build` → `/validate` → `/ship` |
| **Sprint** | Adding a feature to an existing project | `/new-feature` → `/plan` → `/build` → `/validate` → `/ship` |
| **Sprint + Design** | Adding a feature that introduces new screens | `/new-feature` → `/design-screens` → `/plan` → `/build` → `/validate` → `/ship` |
| **Micro** | Single targeted change (≤ 3 files) | `/new-feature` → `gen-component` \| `gen-api-route` \| `add-test` → `/check` → `/ship` |

**Decision shortcut:** default to Sprint for features, Micro for fixes, Full for new projects. Add Design step whenever new screens are being introduced.

### How to describe your task — by mode

**Full** — start with ideation, then design, then architect:
```
/ideate "a task manager for remote teams with per-user lists and a team lead overview"
  → asks 5 discovery questions, drafts SPEC.md, asks for review, writes file on approval

# Option A — design from scratch:
/design-screens mockup.png
  → reads SPEC.md, designs all screens using the active design tool
  → optional: pass reference images (PNG, JPG) for style inspiration

# Option B — wireframes exist (e.g., SVG wireframes from a designer):
/design-draft docs/delivery/wireframes/
  → reads each wireframe SVG visually + source, sends to Stitch for polished drafts
  → outputs HTML + PNG into designs/drafts/
/design-screens designs/drafts/a1-welcome.png designs/drafts/a2-sign-in.png ...
  → uses Stitch drafts as reference images for the final Paper/Pencil artboards

/plan    ← reads SPEC.md + design artboards, produces PLAN.md + task.md
/build
```

**Sprint** — if your feature is not yet in `SPEC.md`, append a user story before `/plan`:
```
# In SPEC.md, add a section like:
## Feature: dark mode toggle
As a user, I want to switch between light and dark themes.
Acceptance: toggle in settings, preference persisted.

/new-feature "dark-mode-toggle"
/plan    ← reads the new SPEC.md section, scopes the plan to it
/build
```

**Sprint + Design** — when the feature introduces new screens:
```
/new-feature "onboarding wizard"
/design-screens wireframe.png  ← design the new screens first
/plan                          ← /plan can now read the design artboards
/build
```

**Micro** — no SPEC.md, PLAN.md, or task.md needed. The argument to `/new-feature` is the task.

*Fixing or modifying something that exists* (bug fix, style tweak, copy change):
```
/new-feature "fix login button color on mobile"
# Describe the change — Claude reads the file, edits it, confirms the change is correct.
# Bug fix? If no test covers this path → /add-test before /check.
/check
/ship
```

*Creating a new artifact* (new component, new route, new test):
```
/new-feature "add user avatar component"
/gen-component UserAvatar    ← or gen-api-route, add-test, gen-animation
/check
/ship
```

Use `gen-*` only when creating something from scratch. For edits and fixes, just describe the change — no skill needed.

After any edit, quick self-check: 🔴 solves the problem? 🟡 change is minimal? 💭 test coverage exists?

Do not use `/build` — it requires `task.md`, which Micro mode never creates.

Full reference: [docs/workflow/modes.md](../../docs/workflow/modes.md)

---

## The 6-Phase Loop

```
Phase 1: Ideate    → SPEC.md              (/ideate or Antigravity)
Phase 2: Design    → designs/*.paper|.pen (/design-draft → /design-screens + Paper or Pencil MCP)
Phase 3: Architect → PLAN.md + task.md   (/plan)
Phase 4: Build     → codebase            (/build)
Phase 5: Validate  → walkthrough.md      (/validate)
Phase 6: Ship      → deployed PR         (/ship)
```

Each phase produces one artifact. The next phase cannot start without it.

---

## Commands — in order of use

### Phase 1 — Ideation
```
/ideate "your idea or problem description"
```
Runs an interactive discovery session inside Claude Code. Asks 5 targeted questions (batched in one message), drafts a complete `SPEC.md`, shows you the draft for review, and writes the file when you approve. Output is identical to an Antigravity-produced SPEC.md.

Alternatively: use Antigravity externally and save its output as `SPEC.md`.

---

### Phase 2 — Design

#### Draft generation (optional accelerator)

```
/design-draft
/design-draft docs/delivery/wireframes/
/design-draft docs/delivery/wireframes/ --screens=sign-in,dashboard
```

Uses Google Stitch to generate polished draft screens from SPEC.md and/or existing wireframe SVGs. Outputs HTML + PNG into `designs/drafts/` — these become reference images for `/design-screens`.

**From SPEC.md only** (no wireframes):
```
/design-draft
```
Infers screens from user flows in SPEC.md and generates drafts from scratch via Stitch.

**From wireframe SVGs** (recommended when wireframes exist):
```
/design-draft docs/delivery/wireframes/
```
Reads each SVG both visually (multimodal rendering) and as source (XML comments, named groups, dimensions). For each wireframe:
1. Extracts layout structure, component inventory, text labels, and interaction hints
2. Builds an enriched Stitch prompt that preserves the wireframe's exact layout
3. Stitch upgrades the wireframe to a polished UI with colors, typography, and spacing
4. Saves `designs/drafts/[code]-[screen-name].html` + `.png` (preserving the wireframe filename prefix for traceability)

Screens in SPEC.md that have no wireframe are generated from spec context alone. Files named `*flow-map*` are skipped (journey diagrams, not screens).

**Requires Stitch MCP** — if not configured, `/design-draft` prints setup instructions and stops. See `.mcp.json` for the current config.

---

#### Screen design (core Phase 2 command)

```
/design-screens
/design-screens path/to/mockup.png
/design-screens ref1.png ref2.png
/design-screens designs/drafts/a1-welcome.png designs/drafts/a2-sign-in.png
```

Designs all project screens as artboards using the active design tool (Paper or Pencil). This is Phase 2 of the workflow — run it after SPEC.md exists and before `/plan`, so the architect can read the design screens alongside the spec.

**What it does, step by step:**

1. **Reads SPEC.md** — extracts the screen list, user flows, and any UI constraints (mobile-first, dark mode, brand palette, etc.)
2. **Reads PLAN.md** (if it already exists) — for component hierarchy and data shapes per screen
3. **Analyzes your reference images** (if any are passed as arguments) — Claude is multimodal and will ingest PNG, JPG, or PDF files. It extracts layout patterns, color mood, typography personality, and UI density from them. These inform the design style without copying them literally.
4. **Establishes a design brief** — calls the design tool's style guide to produce a palette (6 hex values with roles), font pairing, spacing rhythm, and a one-sentence visual direction. Outputs the brief to you before drawing anything.
5. **Designs each screen** — creates one artboard per screen using the active tool, in user-flow order (e.g., Landing → Sign In → Dashboard → Detail). Builds each screen incrementally (one visual group per call: nav → hero → sections → footer).
6. **Mandatory review checkpoints** — screenshots every 2–3 screens, checks spacing, contrast, alignment, clipping, and type hierarchy. Fixes issues before continuing.
7. **Reports** — lists all artboards created with their dimensions and suggests the next step (`/gen-component`).

**With no reference images:**
```
/design-screens
```
Claude derives the visual direction entirely from SPEC.md (product type, target user, UI constraints) and the active design tool's style guide library.

**With one reference image (brand mockup, wireframe, competitor screenshot):**
```
/design-screens designs/reference/brand-mockup.png
```
Claude reads the image, extracts layout and color mood, and applies that as inspiration — not a clone.

**With multiple images (wireframes + brand guide + example app):**
```
/design-screens wireframes.png brand-colors.png reference-app.png
```
Each image is analyzed independently. Claude synthesizes a coherent brief from all of them.

**Important:** The active design tool must have a project file open before running this skill. If nothing is open, Claude will prompt you to open or create the appropriate file first (`designs/[project-name].paper` for Paper, `designs/[project-name].pen` for Pencil).

---

### Starting a session (Sprint / Micro)
```
/new-feature "task name"
```
Syncs `main`, creates a feature branch, loads all context files. Run this before writing any code.

---

### Phase 3 — Architecture
```
/plan
```
1. Spawns an Explore subagent to scan the existing codebase
2. Reads `SPEC.md` + all design screens
3. Writes `PLAN.md` (stack, architecture, data models, API contract)
4. Writes `task.md` — one checkbox per task, each tagged with a team agent

---

### Phase 4 — Build
```
/build
```
Reads `task.md`, groups tasks by tag and independence, and spawns parallel subagents:
- `[backend]` tasks → Backend Agent (reads `backend/CLAUDE.md`)
- `[frontend]` tasks → Frontend Agent (reads `frontend/CLAUDE.md` + design artboards)
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

### Phase 5 — Validate
```
/validate
```
Spawns 3 parallel subagents (+ a 4th if UX files changed):
- **QA**: runs full test suite, patches failures
- **Security**: checks auth, injection, secrets, XSS, CORS
- **Visual**: compares running app against design artboards
- **UX Language** *(auto-spawned only when `designs/` files were modified)*: audits component names, labels, and text against the domain vocabulary in SPEC.md — see `/audit-ux-language` below

Generates `walkthrough.md` as its output.

---

### Design language audit (standalone)
```
/audit-ux-language
/audit-ux-language --no-wireframes
```
Audits all design artifacts for coherence with the ubiquitous language defined in SPEC.md. Covers:
- **Component names** — flags generic layer names (`Frame1`, `Card`, `Container`) that must be renamed to domain terms
- **Synonym drift** — detects the same concept named differently across screens (`Customer` vs `Client`)
- **Vocabulary gaps** — terms used in design not present in SPEC.md
- **Placeholder leakage** — `Lorem ipsum`, `TODO`, `TBD` in any text node
- **Action verb consistency** — CTAs using different verbs for the same operation across screens
- **Screen naming** — artboard names must match the screen/feature names in SPEC.md
- **Wireframe coherence** — labels and flows in wireframes (`designs/drafts/`) cross-checked against the design file

Wireframes detected automatically: HTML drafts from `/design-draft`, PNG/JPG exports, any file matching `*wireframe*`, `*mockup*`, `*draft*`. Pass `--no-wireframes` to skip.

Writes `designs/ux-language-audit.md`. Errors block `/ship` — treat them like failing tests.

---

### Phase 6 — Ship
```
/ship
```
Runs `/check`, commits, pushes the branch, opens the PR. Merge after human review + CI green.

The PR body follows the template in `.github/PULL_REQUEST_TEMPLATE.md` — automatically pre-filled when opening PRs via GitHub.

---

### End-of-phase audit
```
/review-phase 4
```
Checklist to run before moving to the next phase. Pass the phase number (1–6).

---

## Design Workflow — how all design commands work together

The design commands span Phases 2, 4, and 5. Here is how they connect:

```
PHASE 2a (optional) — /design-draft [wireframes/]
  ↓
  Reads SPEC.md + wireframe SVGs (if provided)
  → Analyzes each wireframe: layout, components, labels (visual + source)
  → Sends enriched prompts to Google Stitch
  → Produces designs/drafts/*.html + *.png (polished drafts)

PHASE 2b — /design-screens [ref.png | designs/drafts/*.png]
  ↓
  Reads SPEC.md + reference images (can use Stitch drafts as references)
  → Produces design artboards (one per screen, Paper or Pencil)
  → Each artboard is the source of truth for that screen's UI

PHASE 4 — /build (Frontend Agent uses design artboards)
  ↓
  /gen-component ScreenName
    → Reads the design artboard for that screen
    → Exports component structure and exact design tokens
    → Generates the component file + test file
    → Matches layout, spacing, colors, typography from the design

  /gen-animation ComponentName
    → Reads motion annotations on the design node
    → Generates GSAP + Lenis animated version
    → Uses useGSAP(), respects prefers-reduced-motion
    → Supports entrance, exit, scroll-driven, hover, page-transition types

PHASE 5 — /validate (Visual Agent)
  ↓
  Compares the running implementation against every design artboard
  → Reports blocking deviations (major layout/color divergence)
  → Reports minor deviations (spacing, font-weight differences)
  → Outputs conformance score: X/Y screens fully conformant (Z%)
```

**When do you run each design command?**

| Command | When to run | Who runs it |
|---|---|---|
| `/set-design-tool paper\|pencil` | Once per project, before any design command | You |
| `/design-draft [wireframes/]` | Optional — before `/design-screens`, when wireframes exist or you want AI drafts | You |
| `/design-screens` | After SPEC.md (and optionally after `/design-draft`), before `/plan` | You (once per feature/project) |
| `/audit-ux-language` | After design screens; or anytime during Phase 2–4 | You (standalone), or `/validate` auto-spawns it |
| `/gen-component Name` | During `/build`, for each screen or component | `/build` dispatches it via Frontend Agent |
| `/gen-animation Name` | During `/build`, for animated elements | `/build` dispatches it via Frontend Agent |
| Visual Agent | During `/validate` (automatic) | `/validate` spawns it automatically |
| UX Language Agent | During `/validate`, if UX files modified (automatic) | `/validate` spawns it automatically |

**Typical design iteration loop (with wireframes):**
```
/set-design-tool paper   ← (or pencil) — run once, stored in designs/.design-tool
/design-draft docs/delivery/wireframes/    ← optional: generate Stitch drafts from wireframes
  → reads SVGs visually + source, produces designs/drafts/*.html + *.png
/design-screens designs/drafts/a1-welcome.png designs/drafts/a2-sign-in.png ...
  → uses Stitch drafts as reference → draw final artboards in Paper/Pencil
  → review in Paper/Pencil, adjust manually if needed
/plan                    ← architect reads the design screens
/build                   ← Frontend Agent calls /gen-component per screen
  → if a screen looks wrong → open Paper/Pencil, fix the artboard → re-run /gen-component
/validate                ← Visual Agent checks app vs. design artboards
  → deviations reported → fix in code or update design → re-run /validate
```

**Without wireframes** — skip `/design-draft` and go straight to `/design-screens`.

---

## Implementation commands

Use these at any point during `/build`:

| Command | What it generates |
|---|---|
| `/gen-component UserCard` | UI component from a design node (Paper or Pencil) — matches exact layout, colors, typography |
| `/gen-animation HeroSection` | GSAP + Lenis animated component — entrance, scroll, hover, or page transition |
| `/gen-api-route POST /users` | Next.js API route with input validation + tests |
| `/gen-contract Registry` | Solidity smart contract following project conventions |
| `/add-test src/api/users.ts` | Test suite for a specific file |

**For `/gen-component` and `/gen-animation`:** The active design tool must have the correct design file open. For Paper: uses `get_basic_info` → `get_screenshot` → `get_jsx` → `get_computed_styles`. For Pencil: uses `get_editor_state` → `get_screenshot` → `batch_get`. The argument is the artboard or node name in the design file.

**For `/gen-contract`:** reads `contracts/CLAUDE.md` for chain, framework, Solidity version, and OpenZeppelin conventions. Generates the contract file, a test file, and deployment script. Always runs `/check` before reporting done.

**For `/gen-api-route`:** reads `backend/CLAUDE.md` for the pattern (Controller → Service → Repository), ORM conventions, and auth rules. Generates the route, service layer, and Jest test. Always runs `/check` before reporting done.

---

## Three-layer architecture — how `/build` routes work

worldSafe-poc has three agent layers that run in parallel during `/build`:

```
[frontend]  tasks → Frontend Agent
  reads: frontend/CLAUDE.md + design artboards
  generates: Next.js pages, React components, Tailwind styles

[backend]   tasks → Backend Agent
  reads: backend/CLAUDE.md
  generates: API routes, services, PostgreSQL queries via ORM

[contracts] tasks → Contracts Agent
  reads: contracts/CLAUDE.md
  generates: Solidity contracts, tests, deployment scripts
```

Tasks tagged `[contracts]` in `task.md` go to the Contracts Agent. The contracts and backend layers are independent — they can run in parallel. Frontend waits on the API contract defined by the backend.

**Typical task split for a Web3 feature:**
```
- [ ] [contracts]  Deploy SafeVault contract with deposit/withdraw/verify functions
- [ ] [backend]    Create POST /api/v1/vault/deposit — calls contract via ethers.js
- [ ] [backend]    Create GET /api/v1/vault/balance/:address
- [ ] [frontend]   Build VaultDashboard component from the design
- [ ] [qa]         Write integration tests for vault deposit flow
```

**Smart contract conventions (read `contracts/CLAUDE.md` for full rules):**
- All contracts inherit from OpenZeppelin base contracts where applicable
- Every public/external function has a NatSpec comment
- Events emitted for every state change
- Reentrancy guard on payable functions
- Tests written in the framework defined in `contracts/CLAUDE.md`

---

## Task tags — how `/build` knows who does what

`/plan` writes `task.md` with tagged tasks:
```
- [ ] [backend]   Create POST /api/v1/users endpoint
- [ ] [frontend]  Build UserCard component from the design
- [ ] [qa]        Write tests for POST /api/v1/users
- [ ] [contracts] Deploy Registry contract
```

`/build` reads the tag and routes each task to the correct agent with the correct CLAUDE.md context. You never manually assign tasks to agents — the tags do it.

**Rules:**
- One task = one tag. Split if two agents are needed.
- `[qa]` tasks always follow the task they test.

---

## Phase exit gates

Each phase 3–6 has explicit pass/fail criteria. Do not advance until the gate passes.

| Gate | Key criteria |
|---|---|
| Phase 2 → 3 | All screens from SPEC.md have a design artboard, design brief established, human reviewed artboards |
| Phase 3 → 4 | No TBDs in CLAUDE.md files, PLAN.md complete, task.md covers all SPEC stories, human approved |
| Phase 4 → 5 | All tasks checked, no `[blocked:]` tasks, `/check` passes, human reviewed diff |
| Phase 5 → 6 | Tests green, zero high-severity security findings, `walkthrough.md` exists and complete, zero UX language errors (if audit ran) |
| Phase 6 → merge | `/check` passes, rebased on `main`, CI green, PR approved by reviewer |

Gate fails → fix the failing criterion, re-run the relevant skill, repeat. Full criteria in each phase doc.

---

## Key files

| File | What it is | Created by |
|---|---|---|
| `SPEC.md` | Product requirements — source of truth | `/ideate` or Antigravity |
| `designs/drafts/*.html\|.png` | Stitch AI drafts — reference images for design | `/design-draft` (optional) |
| `designs/*.paper\|.pen` | UI designs — source of truth for all screens | `/design-screens` + Paper or Pencil MCP |
| `PLAN.md` | Architecture decisions | `/plan` |
| `task.md` | Tagged task checklist | `/plan` |
| `walkthrough.md` | How to run the app | `/validate` |
| `designs/ux-language-audit.md` | UX language coherence report | `/audit-ux-language` (or `/validate` auto) |
| `CLAUDE.md` | Global agent context | Template + `/plan` fills TBDs |
| `backend/CLAUDE.md` | Backend Agent context | Template + `/plan` fills TBDs |
| `frontend/CLAUDE.md` | Frontend Agent context | Template + `/plan` fills TBDs |
| `docs/workflow/modes.md` | Full / Sprint / Micro mode reference | This repo |
| `docs/workflow/phase2-design.md` | Design phase deep-dive: Paper MCP, artboards, design tokens | This repo |
| `docs/workflow/handoff-templates.md` | 4 agent communication templates | This repo |
| `docs/workflow/memory.md` | MCP memory setup for cross-session continuity | This repo |
| `docs/workflow/extending.md` | How to add custom skills and agents | This repo |
| `examples/todo-app/` | Complete reference artifacts (SPEC, PLAN, task.md, walkthrough) | This repo |

---

## Extending the workflow

The workflow is designed to be customized. See `docs/workflow/extending.md` for a full guide covering:
- Good vs. bad skill design (with a worked example: `/gen-migration`)
- Required sections for every agent SKILL.md
- Stack-specific conventions (Prisma, Next.js App Router, Tailwind v4, Foundry)
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
/ideate "user authentication"
  → discovery questions answered
  → SPEC.md written

/design-draft docs/delivery/wireframes/          ← optional: if wireframes exist
  → reads each wireframe SVG (visual + source)
  → sends enriched prompts to Google Stitch
  → outputs designs/drafts/*.html + *.png

/design-screens designs/drafts/a1-welcome.png designs/drafts/a2-sign-in.png ...
  → reads SPEC.md + Stitch draft images (or raw mockups if no /design-draft step)
  → design brief established (palette, fonts, spacing)
  → design artboards created for each screen:
       Sign In, Sign Up, Forgot Password, Dashboard
  → human reviews artboards in the design tool → adjust if needed

/new-feature "user-auth"
  → main synced, branch created

/plan
  → reads SPEC.md + design artboards
  → PLAN.md + task.md written
  → exit gate: human approves PLAN.md before build

/build
  → [frontend] tasks: Frontend Agent calls /gen-component per screen
  → [backend] tasks: Backend Agent builds API routes
  → [qa] tests run after
  → /check passes
  → exit gate: all tasks checked, no blockers

/validate
  → QA: tests green
  → Security: no high findings
  → Visual: app compared against design artboards → conformance score
  → UX Language (auto, if designs/ changed): component names + text audited against SPEC.md
       → errors logged as [design] tasks; report at designs/ux-language-audit.md
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
- `docs/workflow/phase2-design.md` — Paper MCP, artboard conventions, design tokens, gen-component usage
- `docs/workflow/extending.md` — add skills, agents, stack conventions (with quality guide)
- `docs/workflow/memory.md` — persistent MCP memory for multi-session projects
- `docs/workflow/handoff-templates.md` — Task assignment, QA PASS/FAIL, and escalation templates
- `examples/todo-app/` — complete reference artifacts showing what each phase produces
- `README.md` — project overview, tool stack, quick start

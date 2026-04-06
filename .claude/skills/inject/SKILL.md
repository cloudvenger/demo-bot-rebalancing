---
description: Inject the AI development workflow into an existing target repo — analyses stack, asks questions, merges intelligently
disable-model-invocation: true
argument-hint: "[/path/to/repo]"
---

# /inject — Inject Workflow into an Existing Repo

You are injecting the workflow-dev-ia AI development workflow into an existing project.
The **source files** (this repo) are your current working directory.
The **target repo** is the path provided as `$ARGUMENTS`.

---

## Step 1 — Determine target path

If `$ARGUMENTS` is empty, ask:
> "What is the full path to the target repo? (e.g., /Users/you/projects/my-app)"

Validate:
- Directory exists
- Is a git repo: `git -C "$TARGET" rev-parse --git-dir 2>/dev/null`
- If not a git repo: warn but continue (user may have a non-git project)

---

## Step 2 — Analyze target repo

Spawn an **Explore subagent** with this task:

```
Analyze the repository at [TARGET_PATH] and return a structured report with:

1. PROJECT NAME — the name field from package.json, or the directory name
2. FRONTEND DETECTED — yes/no and evidence:
   - Framework: check package.json deps for next, react, vue, nuxt, svelte, @remix-run
   - Styling: tailwind.config.* file OR tailwindcss dep → Tailwind; styled-components; @emotion/react → Emotion; css modules (look for *.module.css)
   - State: zustand, @reduxjs/toolkit, jotai, recoil
   - Data fetching: @tanstack/react-query, swr, @trpc/client
   - Testing: vitest, jest, @testing-library, cypress, playwright
3. BACKEND DETECTED — yes/no and evidence:
   - Node/TS: package.json deps for express, fastify, hono, @nestjs/core, koa
   - ORM: @prisma/client, drizzle-orm, typeorm, sequelize
   - Database: look for DATABASE_URL patterns in .env.example or config files; postgres/mysql/sqlite mentions
   - Auth: jsonwebtoken, passport, next-auth, lucia, better-auth
   - Python: requirements.txt or pyproject.toml with fastapi/django/flask/starlette
   - Go: go.mod with gin/fiber/echo/chi
   - Rust: Cargo.toml with actix-web/axum/warp
4. CONTRACTS DETECTED — yes/no and evidence:
   - Any *.sol files (glob at depth 5)
   - hardhat.config.js or hardhat.config.ts
   - foundry.toml
   - Solidity version from pragma statements
5. EXISTING WORKFLOW FILES:
   - Does target/CLAUDE.md exist? If yes, read its full content and return it
   - Does target/.claude/ exist? List any skills already present
   - Does target/backend/CLAUDE.md exist?
   - Does target/frontend/CLAUDE.md exist?
   - Does target/contracts/CLAUDE.md exist?
   - Does target/designs/ exist with .paper files?
6. MONOREPO signals: package.json workspaces, pnpm-workspace.yaml, turbo.json, nx.json — list found
7. Any other notable files: docker-compose.yml, .env.example, Makefile, justfile/Justfile, CI configs (.github/workflows/)
   - For justfile/Makefile: read the full content and return it (needed to detect existing commands)
```

---

## Step 3 — Print analysis + propose modules

Print a clear summary based on the Explore subagent report:

```
=== Target repo analysis: [project-name] ===

  Frontend     [detected framework] · [styling] · [state] · [data fetching] · [testing]
  Backend      [detected framework] · [ORM] · [database]
  Contracts    [detected / not detected]

  Existing CLAUDE.md:      [YES → will merge intelligently / NO]
  Existing .claude/:       [YES — X skills found / NO]
  Existing frontend/:      [YES / NO]
  Existing backend/:       [YES / NO]
  Designs (Paper):         [found / not found]

=== Proposed injection ===
  [x] Core — .claude/settings.json + 10 core skills + root CLAUDE.md
  [x] Frontend layer — frontend/CLAUDE.md + gen-component skill     ← if frontend detected
  [ ]   └─ Animation (gen-animation) — Paper designs not found     ← conditional
  [x] Backend layer — backend/CLAUDE.md + gen-api-route skill       ← if backend detected
  [ ] Contracts layer — not detected                                 ← if no .sol files
  [x] Justfile — task runner with standard recipes (check, build, test, lint)   ← if no justfile found
  [ ] Justfile — already present, will merge missing standard recipes            ← if justfile exists
  [ ] Workflow docs (docs/workflow/)
  [ ] Templates (templates/SPEC.template.md + PLAN.template.md)
```

Then ask the user to confirm or adjust:
- "Confirm this plan? [y] or tell me what to change:"
- Accept natural language adjustments (e.g., "also add contracts", "skip the docs", "I use SvelteKit not Next.js")
- For any detected value that is uncertain or TBD, ask the user to confirm (e.g., "Database: I found PostgreSQL mentioned in .env.example — confirm? [y/n]")

After confirmation, ask for any stack values that are still unknown:
- For each TBD value in modules being injected, ask the user (accept Enter to keep as TBD)

---

## Step 4 — Intelligent conflict merge for existing CLAUDE.md files

For each CLAUDE.md that already exists in the target:

1. **Read** the existing file
2. **Read** the corresponding source file from this repo (e.g., `./backend/CLAUDE.md`)
3. **Generate a merged version** that:
   - **Preserves** from the original: project description, any custom rules not in the workflow template, any project-specific sections (e.g., "Deployment", "Environment", "Contributing")
   - **Replaces** with workflow versions: Stack section (filled with detected values), SOLID Principles, API Conventions, Database Rules, Security Rules, Agent Rules, Coding Conventions, Available Skills table
   - **Adds** sections from the workflow template that don't exist in the original
   - **Keeps** the original project name and any intro paragraph that describes the specific project
4. Write the merged result directly — no need for a separate review file

For `root CLAUDE.md` specifically:
- Replace the "What is this project?" section with: the original project's description (if it had one) or a generic description referencing the project name
- Fill the Stack section with detected values
- Keep Agent Rules and Coding Conventions from the workflow template (they are generic best practices)
- Update the Available Skills table based on which modules are being injected

---

## Step 5 — Inject files

Use the **Write** tool with **absolute paths** to the target directory.

### Always inject — Core

**Settings:**
```
target/.claude/settings.json  ← copy content from ./.claude/settings.json
```

**Core skills** (copy SKILL.md content from each source skill directory):
- `target/.claude/skills/help/SKILL.md`
- `target/.claude/skills/set-design-tool/SKILL.md`
- `target/.claude/skills/design-screens/SKILL.md`
- `target/.claude/skills/new-feature/SKILL.md`
- `target/.claude/skills/plan/SKILL.md`
- `target/.claude/skills/build/SKILL.md`
- `target/.claude/skills/check/SKILL.md`
- `target/.claude/skills/validate/SKILL.md`
- `target/.claude/skills/ship/SKILL.md`
- `target/.claude/skills/review-phase/SKILL.md`
- `target/.claude/skills/add-test/SKILL.md`

**Core agents** (always included — needed by `/build` QA tasks and `/validate`):
- `target/.claude/agents/qa/SKILL.md`
- `target/.claude/agents/qa-runner/SKILL.md`
- `target/.claude/agents/security/SKILL.md`

**Root CLAUDE.md:**
- If no existing CLAUDE.md: copy `./CLAUDE.md`, replace TBD stack values with detected values, replace "This repo demonstrates..." with project-specific description
- If conflict: write merged version from Step 4

### If frontend confirmed

Read `./frontend/CLAUDE.md`, replace TBD placeholders with detected/confirmed values, write to `target/frontend/CLAUDE.md`.

TBD lines to replace in `frontend/CLAUDE.md`:
- `- **Framework**: TBD (Next.js / Vite+React / SvelteKit / etc.)` → detected framework
- `- **Styling**: TBD (Tailwind CSS / CSS Modules / styled-components)` → detected styling
- `- **State**: TBD (Zustand / Redux / Jotai / Context)` → detected state
- `- **Data fetching**: TBD (React Query / SWR / tRPC)` → detected data fetching
- `- **Testing**: TBD (Vitest / Jest + React Testing Library / Playwright)` → detected testing
- `- **Folder structure**: TBD (Feature-first / Atomic Design)` → TBD (user can run /plan to set)
- `- **Component model**: TBD (Co-located...)` → TBD (user can run /plan to set)

Also inject:
- `target/.claude/skills/gen-component/SKILL.md`
- `target/.claude/skills/gen-animation/SKILL.md` — only if user confirmed animation OR Paper designs found
- `target/.claude/agents/frontend/SKILL.md`
- `target/.claude/agents/visual/SKILL.md` — only if user confirmed animation OR Paper designs found

### If backend confirmed

Read `./backend/CLAUDE.md`, replace TBD placeholders, write to `target/backend/CLAUDE.md`.

TBD lines to replace in `backend/CLAUDE.md`:
- `- **Runtime**: TBD (Node.js / Bun / Python / etc.)` → detected runtime
- `- **Framework**: TBD (Express / Fastify / Hono / FastAPI / etc.)` → detected framework
- `- **ORM**: TBD (Prisma / Drizzle / SQLAlchemy / etc.)` → detected ORM
- `- **Database**: TBD (PostgreSQL / SQLite / etc.)` → detected database
- `- **Auth strategy**: TBD (JWT / session / OAuth)` → detected auth
- `- **Pattern**: TBD (Controller → Service → Repository / Hexagonal / CQRS)` → TBD (set by /plan)

Also inject:
- `target/.claude/skills/gen-api-route/SKILL.md`
- `target/.claude/agents/backend/SKILL.md`

### If contracts confirmed

Read `./contracts/CLAUDE.md`, replace TBD placeholders, write to `target/contracts/CLAUDE.md`.

TBD lines to replace:
- `- **Chain/network**: TBD (Ethereum / Polygon / Base / Arbitrum / etc.)` → detected/confirmed chain
- `- **Framework**: TBD (Hardhat / Foundry)` → detected framework
- `- **Solidity version**: TBD (e.g., ^0.8.24)` → detected from pragma or user input
- `- **Libraries**: TBD (OpenZeppelin / Solmate / etc.)` → detected/confirmed
- `- **Testing approach**: TBD (Hardhat + ethers.js / Foundry forge)` → inferred from framework

Also inject:
- `target/.claude/skills/gen-contract/SKILL.md`
- `target/.claude/agents/contracts/SKILL.md`

### If workflow docs confirmed

Copy all files from `./docs/workflow/` to `target/docs/workflow/`.
Copy `./docs/workflow.md` to `target/docs/workflow.md`.

### If templates confirmed

Copy `./templates/SPEC.template.md` and `./templates/PLAN.template.md` to `target/templates/`.

---

## Step 5b — Generate justfile

After injecting `.claude/` files, create a `justfile` in the target repo root.

**If target already has a justfile:**
1. Read the existing justfile
2. Identify which standard recipes are missing (install, dev, build, test, lint, typecheck, check, ci, clean)
3. Append only the missing recipes at the end with a `# ── Added by workflow-dev-ia ──` comment
4. Preserve all existing custom recipes unchanged

**If target has no justfile:**
Generate one from scratch. Use the detected package manager (check for `bun.lockb` → `bun`; `yarn.lock` → `yarn`; `pnpm-lock.yaml` → `pnpm`; default → `npm`). Map each standard recipe to the actual detected command from `package.json` scripts:

```makefile
# justfile — [project-name]
# Requires: just — https://github.com/casey/just
# Install:  brew install just  (macOS) | apt install just (Linux) | cargo install just (any)
#
# Run `just` or `just --list` to see all available recipes.

set shell := ["bash", "-cu"]
set dotenv-load := true

default:
    @just --list

install:
    [pkg] install

dev:
    [pkg] run dev      # omit if no dev script detected

build:
    [pkg] run build    # omit if no build script detected

test:
    [pkg] run test     # or detected test runner (vitest run, jest, pytest, etc.)

lint:
    [pkg] run lint     # if no lint script: @echo "No linter configured"

typecheck:
    [pkg] run typecheck  # or npx tsc --noEmit if TypeScript detected

# Quality gate: lint + typecheck + test  ← used by /check skill
check: lint typecheck test

ci: install check build

clean:
    rm -rf dist .next .turbo
```

Then append stack-specific recipes if detected:
- **Prisma**: `db-migrate` (`npx prisma migrate dev`), `db-generate` (`npx prisma generate`), `db-studio` (`npx prisma studio`)
- **Vite**: `preview` (`[pkg] run preview`)
- **custom scripts** from package.json not already covered: add as recipes

**Finally:** Add `"Bash(just:*)"` to `target/.claude/settings.json` allowedTools if not already present.

**Prerequisite note:** Print at end of Step 5b:
```
⚠  just task runner required — install with: brew install just
   (Linux: apt install just | cargo install just | https://github.com/casey/just)
```

---

## Step 6 — Print summary

```
=== Injection complete ✓ ===

  .claude/settings.json
  .claude/skills/  → [list injected skills]
  .claude/agents/  → [list injected agents]

  root CLAUDE.md        [merged / fresh]
  frontend/CLAUDE.md    [Next.js · Tailwind CSS · Zustand · React Query · Vitest]
  backend/CLAUDE.md     [Fastify · Prisma · PostgreSQL]
  justfile              [generated / merged]

Next steps:
  1. cd [TARGET_PATH]
  2. Install just if needed: brew install just
  3. Run just -l to verify all recipes loaded
  4. Open Claude Code in the target repo
  5. Run /help to verify skills loaded correctly
  6. Run /new-feature "your feature name" to start building
```

If any TBD values remain unfilled, list them:
```
  Still TBD (fill these in before running /plan):
  - root CLAUDE.md → Database
  - backend/CLAUDE.md → Auth strategy
```

---

## Rules

- **Never** copy: `README.md`, `setup.sh`, `add-module.sh`, `inject-workflow.sh`, `designs/`, `SPEC.md`, `PLAN.md`, `task.md`, `walkthrough.md`
- **Always** create parent directories before writing (`mkdir -p`)
- **Always** use absolute paths when writing to the target
- If a skill already exists in `target/.claude/skills/`, overwrite it (workflow version is always the source of truth for skills)
- If an agent already exists in `target/.claude/agents/`, overwrite it (workflow version is always the source of truth for agents)
- For CLAUDE.md files in layer directories (`backend/`, `frontend/`, `contracts/`): if they already exist, apply the same intelligent merge logic as root CLAUDE.md
- The Explore subagent protects the main context from large file reads — always use it for target analysis
- If the target is a monorepo: note this in the summary and recommend the user manually place CLAUDE.md files in the correct workspace subdirectories

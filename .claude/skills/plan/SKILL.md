---
description: Phase 3 ritual — scan codebase, read spec + design, produce PLAN.md + tagged task.md
---

# /plan — Architecture & Planning

Produce PLAN.md and a tagged task.md from SPEC.md and design files.

## Step 0 — Ask the user

Before doing anything else, ask two questions:

> "Force a full codebase exploration? [y/N]"
> (default: N — uses CLAUDE.md as the architecture source)

Store the answer as `FORCE_EXPLORE`.

> "Does this feature include UI work? If yes, should it use Paper MCP designs or existing source code as the UI reference? [paper/source/none]"
> - `paper` — read the Paper design (open in Paper app) via Paper MCP tools (default if design files exist)
> - `source` — read existing frontend source files instead (use when no Paper design covers this feature)
> - `none` — no UI work in this feature (skip Step 3 entirely)

Store the answer as `UI_SOURCE`.

## Step 1 — Read shared context

1. Read all existing `CLAUDE.md` files (root + backend + frontend + contracts) — note any TBD fields
2. Read `SPEC.md` in full — every user story and acceptance criterion
3. Read `task.md` if it exists — understand what is already done vs outstanding

## Step 2 — Decide whether to Explore

**Skip Explore** if ALL of the following are true:
- `FORCE_EXPLORE` is N
- `CLAUDE.md` has a non-empty Architecture or Codebase Architecture section
- `CLAUDE.md` Stack section has no TBD fields
- `CLAUDE.md` Key Files section exists

**Run Shallow Explore** (spawn an Explore subagent) if ANY of the following:
- `FORCE_EXPLORE` is Y
- `CLAUDE.md` is missing the Architecture section
- Stack section has TBD fields

When running Explore, scope it to **structure and config only** — do not read source files:
```
Explore the codebase at a structural level only. Report:
1. Top-level directory listing (ls, one level deep)
2. package.json / requirements.txt / Cargo.toml — dependencies and scripts only
3. Any config files: tsconfig, vite.config, tailwind.config, .env.example
4. Do NOT read source files — the architecture is documented in CLAUDE.md
```

Use the Explore report to fill any gaps not covered by CLAUDE.md.

## Step 3 — Read UI reference (scoped)

Branch on `UI_SOURCE`:

**If `UI_SOURCE` = `paper`:**
Read only Paper screens relevant to the SPEC features being planned:
- Use `mcp__paper__get_basic_info` to list all artboards (screens)
- Identify which artboards correspond to the SPEC user stories
- Use `mcp__paper__get_screenshot` only for those specific artboards
- Skip screens that are already fully implemented (cross-reference with `task.md`)

**If `UI_SOURCE` = `source`:**
Read existing frontend source files relevant to the SPEC features:
- Identify the relevant components/pages from the feature scope
- Read those files directly — do not open Paper MCP tools
- Use what you find to inform the Component map in PLAN.md

**If `UI_SOURCE` = `none`:**
Skip this step entirely — no UI reference needed.

## Step 4 — Resolve stack and fill TBDs

Ask the user to confirm any remaining TBD fields in CLAUDE.md.
Update the affected CLAUDE.md files with confirmed values before producing PLAN.md.

## Step 5 — Produce PLAN.md

5. Produce `PLAN.md` following `templates/PLAN.template.md` with these sections:
   - **Architecture overview**: folder structure, data flow, layer responsibilities
   - **API contract**: all endpoints with request/response shapes
   - **Data model**: schema and relationships
   - **Component map**: which screens map to which components (from Paper design)
   - **Task breakdown**: one task per endpoint, component, or contract — each independently testable
   - **Out of scope**: explicit list of what is NOT built in this iteration

## Step 6 — Produce task.md with team agent tags

6. Produce `task.md` from the task breakdown. Each task must have a `[tag]` identifying the team agent responsible:

   | Tag | Owned by | Examples |
   |---|---|---|
   | `[backend]` | Backend Agent | API routes, services, DB, auth, migrations |
   | `[frontend]` | Frontend Agent | UI components, hooks, styling, design nodes |
   | `[contracts]` | Contracts Agent | Solidity contracts, deployments, ABIs |
   | `[qa]` | QA Agent | Tests, coverage, integration tests |

   Format — one checkbox per task:
   ```
   - [ ] [backend] Create POST /api/v1/users endpoint with validation
   - [ ] [frontend] Build UserCard component from the Paper design (node: UserCard)
   - [ ] [qa] Write tests for POST /api/v1/users
   - [ ] [backend] Create POST /api/v1/sessions endpoint
   - [ ] [qa] Write tests for POST /api/v1/sessions
   - [ ] [contracts] Deploy Registry contract to Sepolia
   ```

   Rules:
   - Every task has exactly **one** tag — if a task needs two agents, split it into two tasks
   - `[qa]` tasks always appear **after** the implementation task they test
   - Tasks modifying shared types get the tag of the layer that owns the type
   - If a project has no backend, no `[backend]` or `[contracts]` tasks

7. Report: number of tasks created per tag, architectural decisions made, remaining open questions

> This is a complex architectural analysis — ultrathink through trade-offs before writing PLAN.md.

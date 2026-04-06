# Extending This Workflow

The workflow is designed to be customized. You can add new skills (slash commands), new agent roles, and stack-specific conventions without touching the core phases. This guide covers what makes a quality extension and how to build one correctly.

---

## Adding Custom Skills

### File format

Create a directory at `.claude/skills/<name>/` containing a `SKILL.md` file:

```
.claude/
└── skills/
    └── gen-migration/
        └── SKILL.md
```

The file must have YAML frontmatter with a `description` field:

```yaml
---
description: Generate a database migration file from a schema change description
---
```

Then the body: the skill's steps, formatted as numbered instructions for Claude to follow. Invoke with `/<name>` (e.g., `/gen-migration`).

---

### Good skill vs. bad skill

**A good skill:**

| Property | What it means |
|---|---|
| **Single-purpose** | Does one thing with a clear name. `/gen-migration` not `/handle-database` |
| **Bounded scope** | Touches ≤ 5 files in the typical case. If it touches more, it's probably two skills. |
| **Context-aware** | Reads `PLAN.md` and the relevant `CLAUDE.md` before generating anything. Never guesses the stack. |
| **Verifiable** | Ends with `/check` or a concrete verification step. Silent success is not success. |
| **Reusable** | Parameterized by argument, not hardcoded to one case. `/gen-api-route GET /users` not `/gen-get-users-route` |
| **Fails gracefully** | If required context is missing (no `PLAN.md`, no design file), reports the gap clearly instead of generating incorrect output |

**A bad skill:**

| Anti-pattern | Example | Problem |
|---|---|---|
| **Too broad** | `/build-backend` — "implement all backend work" | No clear boundary, cannot succeed, duplicates `/build` |
| **Too narrow** | `/gen-user-delete-route` | One-time use, not reusable — just run `/gen-api-route DELETE /users/:id` |
| **Context-free** | Generates code without reading `PLAN.md` | Produces output that contradicts the architecture |
| **Side-effectful** | A gen-component skill that also edits `frontend/CLAUDE.md` | Modifies files outside its stated responsibility — unexpected for the user |
| **Verification-less** | Generates code, reports done, never runs `/check` | Silent failures pass undetected |
| **Imperative dump** | 30 bullet points with no structure | Claude cannot follow sequential instructions buried in unordered prose |
| **Hardcoded** | Steps reference a specific table name or component name | Skill works once, then becomes dead weight |

---

### Step-limit heuristic

If your skill needs more than 8 steps, it is probably doing two things. Split it.

If a step says "implement [entire feature]", replace it with a call to a subagent or a reference to another skill.

---

### Required sections for a skill SKILL.md

```yaml
---
description: One-line description of what this skill does
---

# /skill-name <argument>

One sentence explaining the purpose.

## Argument
- `<argument>` — what it is and examples

## Steps
1. Read context (CLAUDE.md, PLAN.md, design files as needed)
2. ...
3. Verify (run /check or equivalent)

## Done
Report: what was created/modified, any assumptions made, any gaps flagged.
```

The description in the frontmatter is what Claude Code shows in the `/help` listing. Make it precise.

---

### Worked example: `/gen-migration`

**Create:** `.claude/skills/gen-migration/SKILL.md`

```yaml
---
description: Generate a database migration file from a schema change description
---

# /gen-migration <description>

Generate a database migration from a plain-text description of a schema change.

## Argument

- `<description>` — plain-text description of the change (e.g., "add email_verified boolean to users table")

## Steps

1. Read `CLAUDE.md` to confirm the ORM and migration tool (Prisma, Drizzle, Alembic, etc.)
2. Read `backend/CLAUDE.md` for database conventions: naming, soft-delete patterns, index rules
3. Read `PLAN.md` to confirm the affected table and its current schema
4. Generate the migration file using the project's migration format — name it with a timestamp prefix
5. If the change adds a new column: ensure it has a default value or is nullable (no breaking migration for existing rows)
6. If the change removes a column: use soft-delete (`deleted_at`) unless hard removal is explicitly requested
7. Run `/check` to confirm the migration file passes linting

## Done

Report: migration file path, what changed, whether the migration is reversible (has a down script or rollback).
```

**Why this skill is good:**
- Parameterized: works for any schema change, not one hardcoded table
- Context-aware: reads ORM from `CLAUDE.md` before generating (adapts to Prisma vs Drizzle vs Alembic)
- Bounded: touches exactly one new migration file + runs `/check`
- Verifiable: `/check` at the end catches syntax errors before commit
- Fails correctly: if `PLAN.md` has no table definition, the user gets a clear gap report, not a hallucinated migration

---

## Adding a New Agent Role

### File format

Create a directory at `.claude/agents/<name>/` containing a `SKILL.md` file:

```
.claude/
└── agents/
    └── data-engineer/
        └── SKILL.md
```

Required frontmatter:

```yaml
---
name: Data Engineer Agent
description: Implements data pipeline tasks — ETL jobs, data models, and warehouse integrations
tools: Read, Write, Edit, Bash, Grep, Glob
model: claude-sonnet-4-6
permissionMode: bypassPermissions
---
```

Then reference the agent in `/build` task routing by adding a task tag (e.g., `[data]`) and mapping it to the agent.

---

### Required sections for every agent SKILL.md

Every agent must have all 7 of these sections. Missing one means the agent will encounter an ambiguous situation with no guidance — it will either make a wrong silent choice or stall.

| Section | Purpose |
|---|---|
| **On start** | What to read before doing anything (always includes root `CLAUDE.md` + layer `CLAUDE.md` + `PLAN.md`) |
| **Responsibilities** | What tasks this agent implements — scoped to one tag or clearly bounded role |
| **Rules** | Hard constraints: what this agent must never do, what it must never touch |
| **Communication Style** | How the agent reports, how it references files and design nodes, how it surfaces ambiguity |
| **Success Criteria** | Self-verifiable checklist — the agent runs this before marking any task `[x]` |
| **Uncertainty Protocol** | Table of situations + actions: what to do when SPEC conflicts with PLAN, when context is missing, when blocked |
| **Report when done** | The structure and required content of the final handoff message |

---

### Good agent vs. bad agent

| Property | Good | Bad |
|---|---|---|
| **Single responsibility** | Backend Agent handles only `[backend]` tasks | "Full-stack Agent" that handles everything — parallelism impossible, scope unclear |
| **Reads context first** | Loads `CLAUDE.md` → layer `CLAUDE.md` → `PLAN.md` before first task | Dives into implementation without architectural context |
| **Defined failure mode** | Uncertainty Protocol covers the top 5–6 ambiguous situations | No guidance for when things go wrong — agent improvises |
| **Self-verifiable** | Success Criteria checklist it can run on its own output | "Do good work" — no measurable quality bar |
| **Scoped tools** | Only declares tools it actually needs | Declares all tools "just in case" — noisier, more permissive than necessary |
| **Precise description** | "Implements [backend] tasks — API routes, services, DB, auth" | "Helps with coding" — Claude Code cannot route tasks to vague descriptions |

---

### Worked example: adding a `[data]` agent

**Create:** `.claude/agents/data-engineer/SKILL.md`

```yaml
---
name: Data Engineer Agent
description: Implements data pipeline tasks — ETL jobs, transformations, and warehouse schema changes
tools: Read, Write, Edit, Bash, Grep, Glob
model: claude-sonnet-4-6
permissionMode: bypassPermissions
---

# Data Engineer Agent

You implement `[data]` tasks assigned by the `/build` orchestrator.

## On start

1. Read `CLAUDE.md` — global project conventions
2. Read `backend/CLAUDE.md` — database conventions and ORM patterns
3. Read `PLAN.md` — data architecture, schema, and pipeline design
4. Review the task list provided in your prompt

## Your responsibilities

Execute each `[data]` task in your assigned list:
- Write ETL scripts and transformation jobs
- Apply warehouse schema changes via migration files
- Implement data validation and error handling for pipelines
- Mark each task `[x]` in `task.md` as you complete it

## Rules

- Never modify API routes, frontend components, or business logic services
- All schema changes via migrations — never alter the DB directly
- Idempotent pipelines: running twice must produce the same result as running once
- Do not modify `[qa]` tasks

## Communication Style

- Reports include: pipeline name, input sources, output destinations, row counts (if testable)
- Schema changes always include a rollback path
- Data loss risks are flagged immediately, not noted in passing

## Success Criteria

Before marking any task `[x]`, verify:

- [ ] Pipeline runs without errors on test data
- [ ] Output schema matches the expected schema in PLAN.md
- [ ] Pipeline is idempotent (re-runnable without duplicates or errors)
- [ ] Errors are caught and logged — no silent failures
- [ ] Migration file is timestamped and reversible

## Uncertainty Protocol

| Situation | Action |
|---|---|
| Source schema differs from what PLAN.md describes | Stop. Report: "[Blocked: source schema mismatch at [field]. PLAN.md expected [X], actual is [Y]. Needs human resolution.]" |
| Data transformation has ambiguous business rules | Implement the most conservative interpretation. Document the assumption. |
| A pipeline would delete or overwrite existing production data | Block immediately. Never destructively modify production data without explicit human instruction. |

## Report when done

- Tasks completed (list)
- Files created or modified
- Any schema deviations or data quality issues found
```

---

## Adapting for a Specific Stack

After Phase 3, replace all `TBD` entries in `CLAUDE.md` files with your actual stack choices. Add stack-specific conventions to the relevant layer `CLAUDE.md`. These additions are permanent — they stay for the life of the project.

### Examples of effective stack-specific additions

**Prisma + PostgreSQL** (add to `backend/CLAUDE.md`):

```
- Always use `prisma migrate dev` for schema changes — never edit the DB directly
- Never use `@default(autoincrement())` for IDs in distributed systems — use `cuid()` or `uuid()`
- N+1 prevention: always use `include` or explicit `select` with relations — never query inside a loop
- Soft-delete all user-facing entities: add `deleted_at DateTime?` and filter with `where: { deleted_at: null }`
```

**Next.js App Router** (add to `frontend/CLAUDE.md`):

```
- All data fetching in `page.tsx` and `layout.tsx` (server components) — not in client components
- Client components live in `_components/` subdirectories, prefixed with `'use client'`
- Dynamic routes: `generateStaticParams` for static generation, `loading.tsx` for streaming suspense
- Images: always use `next/image` with explicit `width` and `height` — never raw `<img>`
```

**Tailwind v4** (add to `frontend/CLAUDE.md`):

```
- Design tokens defined in `globals.css` as CSS custom properties under `@theme`
- Never use arbitrary values (`w-[123px]`) — add the value to the theme first
- Component variants: use `cva()` from `class-variance-authority` — not conditional className strings
- Dark mode: use CSS custom property theming, not `dark:` variants
```

**Foundry (Solidity)** (add to `contracts/CLAUDE.md`):

```
- Tests: `ContractName.t.sol` with `contract ContractNameTest is Test`
- Fuzz tests: `function testFuzz_methodName(uint256 amount) public` — no hardcoded amounts in fuzz tests
- Gas snapshots: run `forge snapshot` after any optimization — commit the `.gas-snapshot` file
- Coverage: `forge coverage --report lcov` — minimum 100% line coverage for core logic
```

---

## Anti-patterns to Avoid

| Anti-pattern | Why it's a problem | Fix |
|---|---|---|
| Skill that reads 10+ files before doing anything | Wastes context window, slows execution | Read only files directly needed for this specific skill |
| Agent that declares all available tools | More permissive than needed — violates least-privilege | Declare only tools the agent actually calls |
| Skill that duplicates workflow phase logic | Creates two sources of truth that diverge | Reference the phase doc, don't reimplement it |
| Agent whose `description` is vague | Claude Code cannot route tasks to it correctly | Match description to the task tag: "Implements `[backend]` tasks" |
| Layer CLAUDE.md rule that contradicts root CLAUDE.md | Agents reading both get conflicting instructions | Layer-specific rules extend the root — never contradict it |
| Custom skill with no `/check` step | Quality gate silently bypassed | Always end code-generating skills with `/check` |
| Skill that runs `git add -A` or `git add .` | Accidentally commits `.env`, secrets, or unrelated files | Stage specific files by path only |

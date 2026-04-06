# Operating Modes

The workflow supports three modes. Choose based on the scope of your work.

## Decision table

| Mode | Use when | Skill sequence |
|------|----------|----------------|
| Full | New project from scratch | `/plan` → `/build` → `/validate` → `/ship` |
| Sprint | Adding a feature to an existing project | `/new-feature` → `/plan` → `/build` → `/validate` → `/ship` |
| Micro | Single targeted change (one bug fix, one component, one route, one test) | `/new-feature` → `gen-component` \| `gen-api-route` \| `add-test` → `/check` → `/ship` |

---

## Full mode

**When to use:** New project from scratch — no SPEC.md, no design, no codebase.

**Phases covered:** All 6 (Ideate → Design → Architect → Build → Validate → Ship)

**Before you start:** Phases 1–2 happen outside Claude Code. Run Antigravity (or `/ideate`) to produce `SPEC.md`, then use Paper MCP to create `designs/app.paper`. Once both exist, start with `/plan`.

**Skill sequence:**
```
# Phase 1–2: done manually (Antigravity or /ideate → Paper MCP)
/plan → /build → /validate → /ship
```

**Note:** The default README Quick Start is the Full mode walkthrough.

---

## Sprint mode

**When to use:** Adding a feature to an existing project. SPEC.md and codebase already exist.

**Phases covered:** 3–6 (Architect → Build → Validate → Ship)

**Before you start — describe your task:**

Option A — extend `SPEC.md` with a user story (preferred for multi-task features):
```markdown
## Feature: dark mode toggle
As a user, I want to switch between light and dark themes.
Acceptance: toggle in settings, preference persisted.
```
Then run `/new-feature "dark-mode-toggle"` → `/plan` will scope the plan to the new section.

Option B — pass the description inline to `/new-feature` (for smaller features):
```
/new-feature "add dark mode toggle to settings page"
```
Claude will treat the argument as the task scope when running `/plan`.

**Skill sequence:**
```
/new-feature "task description or name"
/plan → /build → /validate → /ship
```

**Note:** If `SPEC.md` doesn't exist at all, create a minimal one (3–5 sentences describing what the project does and what this feature should accomplish) before running `/plan`.

---

## Micro mode

**When to use:** A single targeted change (≤ 3 files) — one bug fix, one component, one API route, or one test.

**Phases covered:** None — skip planning entirely. Do not use `/build` — it requires `task.md` which doesn't exist in Micro mode. The `gen-*` skills are the direct equivalent for single artifacts.

**Before you start — describe your task:**

The argument to `/new-feature` is your full task description. No SPEC.md or PLAN.md required.

**Path A — modifying or fixing something that already exists** (bug fix, style tweak, copy change, refactor):
```
/new-feature "fix login button color on mobile"
# 1. Describe the change:
#    "In src/components/LoginButton.tsx, change the mobile color from #333 to #0070f3"
# 2. Claude reads the file and edits it.
# 3. Claude reads the changed section back — confirm the edit is correct and minimal.
# 4. For bug fixes: if no test covers this path, run /add-test before /check.
/check
/ship
```

**Path B — creating a new artifact** (new component, new route, new test file):
```
/new-feature "add user avatar component"
/gen-component UserAvatar    ← or /gen-api-route, /add-test, /gen-animation
# Claude verifies the generated artifact against the task description.
/check
/ship
```

Use `gen-*` only when creating something from scratch. For edits and fixes, describe the change directly — Claude reads the file, edits it, and confirms the change before running `/check`.

**After any edit, do a quick self-check:**
- 🔴 Does it solve the stated problem without breaking anything?
- 🟡 Is the change minimal — no unrelated code touched?
- 💭 If it's a bug fix and no test covers this path, add one with `/add-test`.

**Note:** Acceptable only for changes that touch 3 or fewer files. If the change grows beyond that, switch to Sprint mode.

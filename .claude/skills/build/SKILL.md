---
description: Build loop — read task.md, spawn parallel team agents per independent task group, mark tasks done, run quality gate
allowed-tools: Bash, Bash(git *), Read, Write, Edit, Glob, Grep, Task, Git
---

# /build — Orchestrated Build Loop

Read `task.md` and implement all unchecked tasks using parallel team agents where possible.

## Step 1 — Load shared context

Before spawning any agent, read these files yourself:
- `task.md` — collect every unchecked task (`- [ ]`)
- `CLAUDE.md` — project conventions, stack, agent rules
- `SPEC.md` — requirements source of truth
- `PLAN.md` — architecture decisions (if present)

## Step 2 — Group tasks by tag and independence

Tasks in `task.md` are tagged with the team agent responsible:
- `[backend]` → `backend` agent
- `[frontend]` → `frontend` agent
- `[contracts]` → `contracts` agent
- `[qa]` → `qa` agent

**Group by independence within each tag:**
- Tasks with the same tag touching the **same file** → sequential
- Tasks with different tags or different files → parallel

**Always sequential (hard dependencies):**
- A `[backend]` data model change → the `[backend]` endpoint that uses it
- Any implementation task → its corresponding `[qa]` test task
- A shared type/interface change → any code consuming those types

**Can parallelize:**
- `[backend]` endpoint + `[frontend]` component (different layers)
- Two `[frontend]` components touching different files
- Two independent `[backend]` endpoints with no shared code

Build an ordered execution plan before spawning any agent:
```
Group 1 (parallel): [backend] POST /users,  [frontend] UserCard component
Group 2 (parallel): [qa] tests for /users,  [backend] POST /sessions
Group 3:            [qa] tests for /sessions
```

## Step 3 — Spawn team agents

> **CRITICAL — parallelism rule**: For each group, you MUST emit ALL Task tool calls in a **single response message**. Do NOT call Task once, wait for the result, then call Task again. All agents in a group must be launched at the same time in the same message. Wait for all of them to complete before moving to the next group.

Use the named team agents via `subagent_type`. Each prompt only needs to provide:
1. The task list (exact copy from task.md)
2. Any extra context the agent needs (e.g., Paper design node name for frontend tasks)

**The agents know their role, what CLAUDE.md files to read, and operate with full autonomy — no need to repeat those instructions.**

**Prompt templates:**

`[backend]` tasks:
```
Execute these backend tasks from task.md:
- [backend] Create POST /api/v1/users endpoint with validation
- [backend] Create users DB migration

Read PLAN.md (API contract section) for the expected request/response shapes.
Mark each task [x] in task.md when complete. Report files changed and any blockers.
```

`[frontend]` tasks:
```
Execute these frontend tasks from task.md:
- [frontend] Build UserCard component from the Paper design (node: UserCard)
- [frontend] Build UserList page from the Paper design (node: UserList)

The Paper design is open in the Paper app — use mcp__paper__get_basic_info to list artboards,
mcp__paper__get_screenshot for each node listed above, and mcp__paper__get_jsx to export the JSX structure.
Mark each task [x] in task.md when complete. Report files changed and any blockers.
```

`[contracts]` tasks:
```
Execute these contracts tasks from task.md:
- [contracts] Deploy Registry contract to Sepolia
- [contracts] Write Registry.sol

Read PLAN.md (ABI section) for the contract interface.
Mark each task [x] in task.md when complete. Report files changed and any blockers.
```

`[qa]` tasks:
```
Execute these QA tasks from task.md:
- [qa] Write tests for POST /api/v1/users
- [qa] Write tests for users DB migration

Mark each task [x] in task.md when complete. Report test files created and any gaps.
```

> Agents should use the formats in `docs/workflow/handoff-templates.md` when reporting results — Template 1 for task context, Templates 2/3 for QA verdicts.

## Step 4 — After each group

After all agents in a group report completion:
- Mark each finished task as `[x]` in `task.md` immediately
- Check reports for errors or blockers
- If an agent failed, log the blocker and skip dependent tasks (do not cascade failures)

## Step 5 — Quality gate

After all task groups are done, run the project's quality gate:
```
/check
```

This runs lint, typecheck, and tests. Fix any failures before finishing.
Do not report the build complete until `/check` passes.

## Execution example

Given these unchecked tasks in `task.md`:
```
- [ ] [backend] Create POST /api/v1/users endpoint
- [ ] [frontend] Build UserCard component from the Paper design
- [ ] [qa] Write tests for POST /api/v1/users
- [ ] [backend] Create POST /api/v1/sessions endpoint
- [ ] [qa] Write tests for POST /api/v1/sessions
```

Execution plan:
```
Group 1 — emit BOTH Task calls in one message:
  ├── subagent_type: backend  →  Create POST /api/v1/users endpoint
  └── subagent_type: frontend →  Build UserCard component

→ wait for both → mark both done in task.md

Group 2 — emit BOTH Task calls in one message:
  ├── subagent_type: qa       →  Write tests for POST /api/v1/users
  └── subagent_type: backend  →  Create POST /api/v1/sessions endpoint

→ wait for both → mark both done

Group 3 — single Task call:
  └── subagent_type: qa       →  Write tests for POST /api/v1/sessions

→ mark done

Quality gate: /check
```

## Rules
- Use the `[tag]` to determine which agent runs each task — never skip this
- Never run two agents modifying the same file in parallel
- `[qa]` tasks always run **after** the implementation they test
- Mark each task `[x]` in `task.md` immediately when complete — do not batch completions
- If an agent fails, log the blocker and continue with unblocked tasks
- The final quality gate (`/check`) must pass before reporting build complete
- Do not commit — use `/ship` when ready to push
- **Parallel groups MUST be launched in a single message** — sequential Task calls defeat the purpose

---

## Strict mode: `/build --strict`

**When to use:** auth/payments features, critical path work, or when a prior build had cascading failures across tasks.

**How it works:** sequential per-task loop instead of parallel batches:
1. Spawn developer agent for task N
2. Spawn qa-runner for task N
3. If PASS → mark done, advance to task N+1
4. If FAIL → retry (max 3 attempts)
5. If 3 failures → emit Template 4 (Escalation) from `docs/workflow/handoff-templates.md` → pause for human decision

**Output format:** each task emits one of Template 2 (PASS), Template 3 (FAIL), or Template 4 (Escalation) from `docs/workflow/handoff-templates.md`.

**Note:** the default parallel mode is unchanged. `--strict` is permanently opt-in and never becomes the default.

---

## When a task is blocked

Follow this protocol in order:

1. **Check dependency ordering** — verify no prerequisite task is still unfinished; reorder if needed
2. **Retry with more context** — re-read `PLAN.md` and `SPEC.md`, clarify acceptance criteria in the agent prompt, retry
3. **Emit Template 4 (Escalation)** — use the escalation template from `docs/workflow/handoff-templates.md`; document failure history and root cause
4. **Annotate task.md** — mark the task as `[blocked: reason]`, then continue with unblocked tasks

**Final rule:** a phase with blocked tasks cannot pass its exit gate. A human decision is required before advancing.

# Handoff Templates

These four templates standardize how agents communicate task assignments, QA verdicts, and escalations. Copy-paste them directly into agent prompts.

- **Template 1** — used by `/build` when spawning an agent for a task
- **Templates 2 and 3** — used by `qa-runner` when reporting a verdict in strict mode
- **Template 4** — used when a task has exhausted all 3 retry attempts

---

## Template 1 — Task Assignment

Use this when `/build` hands a task off to an implementation agent.

```
To: <agent role — e.g. Backend Agent, Frontend Agent>
Task: <task ID and description from task.md — e.g. "[backend] Create POST /api/v1/users endpoint">

Context:
- PLAN.md section: <section title — e.g. "API Contract > POST /api/v1/users">
- Files to read before starting: <list — e.g. backend/CLAUDE.md, SPEC.md §User Registration>
- Acceptance criteria:
    - <criterion 1>
    - <criterion 2>
    - <criterion 3>

Scope:
- May modify: <list of files and directories in scope>
- Do not modify: <list of files and directories out of scope>

Handoff to: <who receives the output — e.g. QA Agent, Main Agent>
```

---

## Template 2 — QA PASS

Use this when `qa-runner` completes verification in strict mode and all criteria are met.

```
Task: <task ID and description>
Attempt: <N> of 3
Verdict: PASS

Evidence:
- Tests run: <list of test files or commands executed>
- Criteria checked:
    - [x] <criterion 1>
    - [x] <criterion 2>
    - [x] <criterion 3>

Next action: mark [x] in task.md for this task, advance to next task
```

---

## Template 3 — QA FAIL

Use this when `qa-runner` finds failures in strict mode. Each issue must include enough detail for the implementation agent to fix it without guesswork.

```
Task: <task ID and description>
Attempt: <N> of 3
Verdict: FAIL

Issues:
1. <short issue title>
   Expected: <what the correct behavior or output should be>
   Actual:   <what was observed>
   File:line: <path/to/file.ext:line number>
   Fix: <specific instruction — e.g. "validate that email is non-empty before inserting">

2. <short issue title>
   Expected: <...>
   Actual:   <...>
   File:line: <...>
   Fix: <...>

Acceptance criteria status:
- [x] <passing criterion>
- [ ] <failing criterion>
- [ ] <failing criterion>

Retry instructions:
- Fix only the issues listed above — do not change unrelated code
- Do not add new features or refactor outside the listed files
- Run /check (lint, typecheck, tests) before returning for QA
- Re-submit using this same template format
```

---

## Template 4 — Escalation

Use this when a task has failed QA 3 times and human intervention is required. The build loop pauses until a human makes a resolution decision.

```
Task: <task ID and description>
Attempts: 3 of 3

Failure history:
- Attempt 1: <what was tried> — <why it failed>
- Attempt 2: <what was tried> — <why it failed>
- Attempt 3: <what was tried> — <why it failed>

Root cause: <one sentence describing the underlying reason all attempts failed>

Resolution options:
- Decompose: break this task into smaller sub-tasks and re-queue
- Revise approach: <specific alternative approach to try>
- Defer: annotate as [blocked: reason] in task.md and continue other tasks
- Accept with limitation: merge as-is and document the known gap

Impact:
- Blocked tasks: <list of task IDs that cannot start until this resolves>
- Quality compromise if accepted: <what breaks or degrades if the task is accepted as-is>

Awaiting human decision before proceeding.
```

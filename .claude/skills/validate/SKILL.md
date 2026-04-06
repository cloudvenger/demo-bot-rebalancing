---
description: Validation phase — spawn parallel QA, security, and visual agents, generate walkthrough.md
allowed-tools: Bash, Bash(git *), Read, Write, Edit, Glob, Grep, Task, Git
---

# /validate — Phase 5 Validation

Run the full validation suite before shipping. Spawns parallel team agents for tests, security, and visual regression, then generates `walkthrough.md`.

## Step 1 — Pre-check

Read:
- `task.md` — all tasks must be `[x]` before validation starts
- `CLAUDE.md` — quality gate command for this project
- `SPEC.md` — acceptance criteria that must be verified

If any tasks in `task.md` are still unchecked (`- [ ]`), stop and run `/build` first.

Detect whether UX files were modified in the current branch:

```bash
git diff main --name-only | grep -E "designs/|\.paper$|\.pen$|\.html$|wireframe|mockup|draft"
```

Set `UX_CHANGED=true` if any matches are found. This controls whether the UX language agent is spawned in Step 2.

## Step 2 — Spawn parallel validation agents

> **CRITICAL**: Emit all Task tool calls in a **single response message**. Do not spawn them one by one.

Use the named validation agents via `subagent_type`. The agents know their role and operate with full autonomy — prompts only need to pass context-specific instructions.

**QA Runner agent** (`subagent_type: qa-runner`):
```
Run the full test suite for this project. Read CLAUDE.md to find the test command.
Fix any failing tests. Report total tests run, failures fixed, and final pass/fail status.
```

**Security agent** (`subagent_type: security`):
```
Audit this codebase for security vulnerabilities.
Fix all high-severity issues. Document medium and low issues in your report.
```

**Visual agent** (`subagent_type: visual`):
```
Compare implementation against the Paper design (open in Paper app).
Report blocking and minor deviations per screen. Do not fix anything — flag only.
```

**UX Language agent** (`subagent_type: general-purpose`) — **spawn only if `UX_CHANGED=true`**:
```
Run the /audit-ux-language skill. Read SPEC.md to extract the domain glossary, then audit
all design files in designs/ and wireframes in designs/drafts/ for naming coherence, synonym
drift, placeholder leakage, and screen naming alignment. Write the report to
designs/ux-language-audit.md and return the full findings.
```

## Step 3 — Collect reports and resolve blockers

After all agents complete:

1. **QA report**: if any tests are still failing, fix them before continuing
2. **Security report**: fix all `high` severity issues immediately; document `medium` and `low` for the PR
3. **Visual report**: blocking deviations → create entries in `task.md` as `[frontend]` tasks; minor deviations → note in PR description
4. **UX language report** (if spawned): errors → create entries in `task.md` as `[design]` tasks that must be fixed before `/ship`; warnings → note in PR description; report written to `designs/ux-language-audit.md`

Re-run `/check` after security fixes to confirm the quality gate still passes.

## Step 4 — Generate walkthrough.md

Write `walkthrough.md` at the project root documenting how to run the app:

```markdown
# How to run [Project Name]

## Prerequisites
- [Runtime version, e.g., Node 20+]
- [Required env variables: copy .env.example to .env]
- [External services needed: DB, Redis, etc.]

## Setup
[Install command — e.g., npm install]
[DB setup — e.g., npx prisma migrate dev]

## Development
[Dev server command]
[Test command]
[Lint + typecheck command]

## Key URLs
- App: http://localhost:[port]
- API: http://localhost:[port]/api/v1
- [Any other important endpoints]
```

## Step 5 — Sign off

Report:
- **Tests**: total passing, failures fixed, any still failing
- **Security**: issues found, high-severity fixes applied, open medium/low items
- **Visual**: screens reviewed, blocking deviations flagged, minor deviations noted
- **UX Language** (if run): errors found, warnings found, report at `designs/ux-language-audit.md`
- **walkthrough.md**: written ✓

Phase 5 is complete when:
- All tests pass
- No high-severity security issues remain
- Blocking visual deviations are logged as tasks
- UX language errors are logged as `[design]` tasks (if audit ran)
- `walkthrough.md` exists and is accurate

> This is a multi-dimensional validation — ultrathink through the security audit findings before applying fixes.

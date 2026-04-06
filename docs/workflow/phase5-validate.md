# Phase 5 — Validation

**Tool: Claude Code (`/validate` skill) + CI**

This phase ensures the application is correct, stable, and secure before shipping.

## What happens

```
/validate
  ├── QA Subagent:       run full test suite, patch failures
  ├── Security Subagent: audit auth, injection, secrets, XSS, CORS
  └── Visual Subagent:   compare app vs Paper designs (mcp__paper__get_screenshot)
→ collect reports → fix high-severity issues → generate walkthrough.md
```

The 3 subagents run **in parallel**. Each reports findings independently. The main agent merges the reports and fixes blocking issues.

## What `/validate` does

1. **Pre-check**: all tasks in `task.md` must be `[x]` — if not, run `/build` first
2. **QA Subagent**: runs the full test suite; fixes failing tests
3. **Security Subagent**: audits auth guards, input validation, injection, hardcoded secrets, XSS, CORS, vulnerable dependencies
4. **Visual Subagent**: compares each Paper screen against the running implementation; flags blocking deviations for human review
5. **Merge reports**: fix all `high` security issues; log `medium/low`; create `[frontend]` tasks for blocking visual deviations
6. **Re-run `/check`** after any security fixes
7. **Generate `walkthrough.md`**: documents prerequisites, setup, dev commands, key URLs

## Severity levels

| Level | Security | Visual |
|---|---|---|
| **High / Blocking** | Fix before shipping | Flag for human review, create task |
| **Medium** | Document in PR | Note in PR description |
| **Low** | Note only | Ignore |

## Deliverable

- All tests passing
- No high-severity security issues
- Blocking visual deviations logged as `[frontend]` tasks
- `walkthrough.md` written at project root

## Intra-phase iteration
```
/validate → failing tests → QA subagent patches → /validate again
/validate → security issue → fix → /check → continue
```

---

## Exit Gate — Phase 5 → 6

| Criterion | Threshold | How to verify |
|---|---|---|
| All tests passing | 0 failures | `/check` — `npm test` exits 0 |
| Zero high-severity security issues | 0 high findings | Security agent report — no `High` items |
| `walkthrough.md` exists and is complete | File present, covers: prerequisites, setup, dev commands, key URLs | File exists at project root and has all four sections |
| All blocking visual deviations logged as tasks | 0 unlogged blocking deviations | Visual agent report cross-referenced with task.md |
| Human has reviewed validation report | Approval before Phase 6 | Human reviews reports before running `/ship` |

Gate fails → return to build/validate loop, fix issues, re-run `/validate`.

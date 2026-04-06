# Phase 6 — Ship

**Tools: Claude Code Skills + Git + CI/CD**

## What happens
```
/commit                     → structured commit message
/review-pr                  → self-review of the diff before pushing
gh pr create                → create PR with generated description
CI/CD pipeline              → automated lint, test, build, deploy
```

## Commit conventions (via `/commit` skill)
- Type prefix: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`
- Reference the user story: `feat: add user registration (#3)`
- Co-authored by Claude Code

## PR conventions
- Title: under 70 characters
- Body: summary of changes, test plan, link to relevant SPEC.md story
- Must pass all CI checks before merge

---

## Exit Gate — Phase 6 (Ready to Merge)

| Criterion | Threshold | How to verify |
|---|---|---|
| `/check` passes | 0 failures | Run `/check` immediately before committing |
| Branch rebased on latest `main` | 0 commits behind | `git status` shows up to date with origin/main |
| PR title ≤ 70 characters | ≤ 70 chars | Count characters in PR title |
| PR body has: summary, test plan, SPEC.md story link | All three sections present | Manual review of PR body |
| All CI checks green | 0 failing checks | GitHub CI status page |
| Human approval received | PR approved by ≥ 1 reviewer | GitHub PR review approval |

Gate fails → fix the specific failing criterion, do not merge until all pass.

# Git Strategy — Trunk-Based Development

This workflow uses **trunk-based development**: short-lived feature branches that merge back to `main` frequently.

## Why trunk-based?
AI agents work in focused bursts — they implement a feature, write tests, and are done. Long-lived branches that drift from `main` create merge conflicts that agents handle poorly. Short branches avoid this entirely.

## How it works
```
main ─────────────────────────────────────────────────→
  ├── feat/user-auth ──(PR)──→ merge (< 1 day)
  ├── feat/dashboard ──(PR)──→ merge (< 1 day)
  └── fix/login-error ──(PR)──→ merge (< 1 hour)
```

## Agent git flow — required for every codebase change

Every time Claude Code (or any agent) modifies the codebase, it must follow this sequence without exception:

```
git pull origin main          # start from latest main
git checkout -b feat/my-task  # create a branch
# ... implement, test, lint ...
/commit                       # structured commit message
git push -u origin feat/my-task
gh pr create                  # open PR with description
# human reviews and approves
gh pr merge --squash          # merge after approval
git checkout main && git pull # return to clean main
```

No change — however small — is committed directly to `main`.

## Rules
- **One branch per user story**: branch name maps to the task (e.g., `feat/user-registration`)
- **Branch lifespan < 1 day**: agents should complete, test, and PR within a single session
- **Always branch from latest `main`**: run `git pull origin main` before creating a branch
- **Never commit directly to `main`**: all changes go through a PR, even small fixes
- **Resolve conflicts immediately**: if `main` has moved, rebase before opening the PR

## Parallel agents and file conflicts
When two subagents run in parallel (e.g., backend + frontend), they work on different directories and rarely conflict. The `PLAN.md` folder structure ensures clear boundaries. If a conflict arises:
1. The second agent to merge rebases on the updated `main`
2. Claude Code resolves the conflict (it can read both sides of the diff)
3. Human reviews the resolution before merge

## Branch naming convention
```
feat/   → new feature          (feat/user-profile)
fix/    → bug fix              (fix/login-redirect)
test/   → adding tests         (test/auth-coverage)
refactor/ → code restructure   (refactor/api-client)
docs/   → documentation only   (docs/api-reference)
```

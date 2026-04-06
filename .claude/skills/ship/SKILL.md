---
description: End ritual — check, commit, push, open PR
disable-model-invocation: true
---

End-of-task ritual: quality gate, commit, push, open PR.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Run `/check` — lint, typecheck, and tests must all pass before continuing
3. Stage and commit:
   ```
   git add <specific files changed>
   git commit -m "type: concise description of what and why"
   ```
   - Never use `git add .` or `git add -A` — stage specific files only
   - Commit message types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`
   - Do NOT add `Co-Authored-By` trailers or `🤖 Generated with Claude Code` to commit messages
3b. Scan staged files for absolute paths:
   ```
   git diff --cached -- . ':(exclude)*.lock' | grep -n "^\+" | grep -E '(^|\s|"|\x27)(/Users/|/home/|/root/|/var/folders/)' || true
   ```
   - If any matches are found: **stop**. List each file and offending line. Say: "Absolute path detected — remove it before pushing." Do not proceed until the user fixes and re-stages.
   - Also check `settings.json` specifically for `additionalDirectories` containing absolute paths.
   - Allowed exceptions: comments explaining a path is an example, or paths inside quoted shell heredocs that reference `$HOME` variables (not literals).
4. Push the branch:
   ```
   git push -u origin <branch-name>
   ```
5. Open a PR:
   ```
   gh pr create --title "<title>" --body "<summary>"
   ```
   PR body must include:
   - What changed and why
   - How to test (what to run, what to look for)
   - Screenshots for any UI changes
   - Do NOT include `🤖 Generated with Claude Code` or `Co-Authored-By` attribution
6. Update `task.md` — mark the completed task as done
7. Report: commit hash, PR URL

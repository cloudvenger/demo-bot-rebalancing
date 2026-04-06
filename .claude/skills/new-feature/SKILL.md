---
description: Start ritual — sync main, create branch, load context
argument-hint: "[feature-name]"
---

Start a new feature or task.

The argument is either a short branch name ("dark-mode-toggle") or a full task description ("fix login button color on mobile"). Both are valid — use whichever fits your mode.

Steps:
1. Sync main and create a branch:
   ```
   git checkout main && git pull origin main
   git checkout -b feat/<short-task-name>
   ```
2. Determine the mode based on what exists:
   - **Micro** (no SPEC.md / PLAN.md / task.md needed): skip steps 3–4. The argument to this command is the full task description — use it as context for the next gen-* skill. Go to step 5.
   - **Sprint** (SPEC.md exists): continue to step 3.
   - **Full** (SPEC.md + PLAN.md + task.md exist): continue to step 3.

3. Read `SPEC.md`:
   - If the feature is covered: confirm it is in scope and identify the relevant user story.
   - If the feature is NOT covered: either append a brief user story to `SPEC.md` now, or treat the argument passed to this command as the task description and proceed. The `/plan` skill will use it as scope.
   - If `SPEC.md` does not exist: create a minimal version (3–5 sentences: what the project does + what this feature should accomplish) before running `/plan`.

4. Read `PLAN.md` and `task.md` if they exist:
   - Identify which task is being implemented and its dependencies.
   - Mark the task as in-progress in `task.md`.
   - If neither file exists, they will be created by `/plan` — skip this step.

5. Read all `CLAUDE.md` files relevant to the layer being touched (root + backend/frontend/contracts as needed).

6. For UI work: open the Paper design and read the relevant design node via Paper MCP (`mcp__paper__get_basic_info`, `mcp__paper__get_screenshot`) before writing any component code.

7. Report: branch name, mode detected (Full / Sprint / Micro), task being implemented, files that will need to change.

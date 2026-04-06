---
description: Quality gate — lint, typecheck, unit tests
---

Run the quality gate before any commit. All steps must pass.

## Detection

First, check if a `justfile` exists in the project root:
- **If justfile found** → run `just check` (single command that runs lint + typecheck + test via recipe dependencies)
- **If no justfile** → run the individual commands below

## Steps (when running manually / no justfile)

1. Run lint:
   ```
   npm run lint       # or the project's lint command
   ```
   Fix all lint errors before proceeding. Do not suppress warnings with inline disable comments.

2. Run type-check:
   ```
   npm run typecheck  # or tsc --noEmit
   ```
   Fix all type errors. Do not use `any` casts or `@ts-ignore` to silence errors.

3. Run tests:
   ```
   npm test           # or npm run test, vitest, jest, etc.
   ```
   All tests must pass. If a test is failing due to a real bug, fix the bug. If it is a flaky test, investigate before skipping.

4. Report results using this format:

```
✅ Quality gate passed
• Lint:      PASS
• Typecheck: PASS
• Tests:     PASS
• Modified:  [list any files auto-fixed]
```

If any step fails:
```
🔴 Quality gate failed — stopping
• Lint:      FAIL → [error summary]
• Typecheck: PASS
• Tests:     PASS
Show the full error output. Do not proceed until all steps pass.
```

> When a justfile is present: `just check` is the canonical quality gate command.
> When no justfile: adapt commands to the actual scripts in `package.json`. Check `CLAUDE.md` for the project's testing framework.

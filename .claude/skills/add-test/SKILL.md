---
description: Generate tests for a given file or function
argument-hint: "[file-path or function-name]"
---

Generate tests for a given file or function.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Identify the file or function to test from the arguments, or ask the user
3. Read the target file in full before writing any tests
4. Read the relevant `CLAUDE.md` (root + layer) to understand the testing framework and conventions
5. Determine the test type needed:
   - **Unit test**: pure functions, hooks, utilities — test in isolation with mocks for dependencies
   - **Integration test**: API routes, DB operations — test against a real (test) DB
   - **Component test**: UI components — test rendering, interaction, and state
   - **E2E test**: full user flows — only for critical paths
6. Generate the test file:
   - Place co-located with the source file (or in the `__tests__/` convention if the project uses it)
   - Cover: happy path, edge cases, error cases
   - Each test has a single, clear assertion
   - No test logic dependencies between tests (each test is independent)
   - Mock only external dependencies (network, DB, time) — never mock the code under test
7. Run `/check` — all tests must pass before proceeding
8. Report: test file path, number of tests added, any cases that could not be covered and why

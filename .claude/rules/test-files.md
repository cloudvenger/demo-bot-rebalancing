---
description: Test file conventions — loaded automatically when working on test files
paths: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.js", "**/*.spec.ts", "**/*.spec.tsx", "**/*.spec.js", "**/tests/**", "**/__tests__/**"]
---

# Test Conventions

- Test file name mirrors the source file: `UserCard.tsx` → `UserCard.test.tsx`
- One test file per source file — do not combine tests from multiple modules
- Test descriptions must be human-readable: `it("shows an error when email is invalid")`
- Never commit `test.only` or `describe.only` — they silently skip the rest of the suite
- Test behavior and outputs, not implementation details or internal state
- Each test must be fully independent — no shared mutable state between tests
- Use test factories or fixtures instead of inline object literals for complex data
- Mock only at system boundaries (network, file system, time) — never mock internal modules
- A passing test suite with low coverage is worse than a small suite with high coverage of critical paths

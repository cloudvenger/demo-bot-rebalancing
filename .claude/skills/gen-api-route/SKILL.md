---
description: Generate an API route following project conventions
argument-hint: "[METHOD /path]"
---

Generate an API route following project conventions.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Ask the user (or use arguments): what resource and HTTP method? (e.g. "POST /users", "GET /products/:id")
3. Read `PLAN.md` — verify this endpoint is in the API contract before generating
   - If the endpoint is not in the contract, flag it to the user before proceeding
4. Read `backend/CLAUDE.md` for stack, conventions, and validation rules
5. Read `SPEC.md` to understand the data model and acceptance criteria for this resource
6. Generate the route handler:
   - Input validation (reject unknown fields, validate types and required fields)
   - Business logic (or a clear TODO comment if logic is not yet specified)
   - Consistent response shape: `{ data, error }`
   - Correct HTTP status codes
   - No secrets or credentials in code
7. Generate or update the database schema/migration if the route requires new fields
   - Run the migration immediately after applying the schema change
8. Generate tests for the route:
   - Happy path test
   - Validation error test (missing/invalid fields)
   - Auth error test (if route is protected)
9. Run `/check` — fix any failures before proceeding
10. Report: route file path, schema/migration changes (if any), test file path

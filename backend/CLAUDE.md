# Backend Agent Context

Inherits all rules from root [CLAUDE.md](../CLAUDE.md). Rules below are specific to the backend layer.

---

## Responsibilities
- Database schema and migrations
- API routes and business logic
- Authentication and authorization
- Server-side validation
- Background jobs and cron tasks

---

## Stack (fill in after scaffolding)
- **Runtime**: TBD (Node.js / Bun / Python / etc.)
- **Framework**: TBD (Express / Fastify / Hono / FastAPI / etc.)
- **ORM**: TBD (Prisma / Drizzle / SQLAlchemy / etc.)
- **Database**: TBD (PostgreSQL / SQLite / etc.)
- **Auth strategy**: TBD (JWT / session / OAuth)

---

## Architecture Pattern
- **Pattern**: TBD (Controller → Service → Repository / Hexagonal / CQRS)
- **Layer responsibilities** (once pattern is chosen):
  - **Controller** (`routes/`): parse request, validate input, call service, return response — no business logic here
  - **Service** (`services/`): business logic, domain rules, orchestration — no HTTP or DB concerns here
  - **Repository** (`repositories/`): data access only — no business logic, returns domain objects

> Filled in during Phase 3 by `/plan`. Do not add business logic to controllers or HTTP calls to services.

---

## SOLID Principles

Apply SOLID at every layer. These are not optional style preferences — violations produce code that is hard to test, hard to extend, and fragile under change.

| Principle | Rule in this codebase |
|---|---|
| **S** — Single Responsibility | One class/module = one reason to change. Each controller handles one resource. Each service owns one domain concept. Each repository touches one entity. |
| **O** — Open/Closed | Services implement interfaces — adding behavior means a new implementation, not modifying existing code. Never modify a working service to add a tangentially related feature; add a new service or extend via composition. |
| **L** — Liskov Substitution | Any implementation of a service interface must be fully substitutable for another. This is what makes mocking in tests possible — if a `UserService` mock doesn't behave like the real one, the tests are meaningless. |
| **I** — Interface Segregation | Keep interfaces narrow. Don't bundle unrelated methods in one interface — split by caller use case. A read-only consumer should not depend on an interface that exposes mutating methods. |
| **D** — Dependency Inversion | Controllers depend on service **interfaces**, not concrete classes. Services depend on repository **interfaces**, not ORM classes directly. Inject dependencies via constructor — never instantiate dependencies inside a class. |

**Practical checklist before any PR:**
- [ ] Does this class/module do exactly one thing? If not, extract.
- [ ] Does this change require modifying a class that was already working? If yes, consider extending instead.
- [ ] Are concrete classes injected from outside, not instantiated inside?
- [ ] Could you swap the repository for a mock without changing the service code?

---

## API Conventions
- All routes prefixed with `/api/v1/`
- Use RESTful naming: `GET /api/v1/users`, `POST /api/v1/users`, `DELETE /api/v1/users/:id`
- Return consistent JSON shape:
  ```json
  { "data": ..., "error": null }     // success
  { "data": null, "error": "..." }   // failure
  ```
- HTTP status codes must be semantically correct (200, 201, 400, 401, 403, 404, 500)
- Never expose internal error details to the client in production

---

## Validation Rules
- Validate all inputs at the route handler level before touching the DB
- Reject unknown fields (strip or error on extra properties)
- All user-facing strings must be sanitized to prevent injection

---

## Database Rules
- All schema changes via migrations — never mutate the DB directly
- Soft-delete sensitive records (add `deleted_at` field), never hard delete
- Index all foreign keys and frequently queried fields
- No N+1 queries — batch or join where possible

---

## Security Rules
- Passwords must be hashed (bcrypt / argon2) — never stored in plain text
- JWT secrets and DB credentials live in `.env` — never in code
- Rate-limit all auth endpoints
- CORS must be explicitly configured — never use wildcard `*` in production

---

## Testing
- Unit tests for all business logic functions
- Integration tests for all API routes (happy path + error cases)
- Use test database, never the development database

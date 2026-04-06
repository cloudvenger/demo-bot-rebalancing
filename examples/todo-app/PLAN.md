# PLAN — TodoFlow

## Stack Decisions

| Concern | Decision | Rationale |
|---|---|---|
| Runtime | Node.js 20 (LTS) | Stable, Vercel-native |
| Backend framework | Hono | Lightweight, edge-ready, TypeScript-first |
| Database | PostgreSQL 16 | Reliable, Railway-native, relational model fits user/task ownership |
| ORM | Prisma | Type-safe queries, migration tooling, strong ecosystem |
| Auth | JWT in httpOnly cookie | Required by SPEC.md constraints |
| Frontend framework | Next.js 14 (App Router) | Vercel deployment, RSC for shell, client components for task interactions |
| Styling | Tailwind CSS v4 | Design system via `@theme` tokens, zero runtime |
| State / data fetching | React Query (TanStack Query v5) | Server state management, optimistic updates for task toggling |
| Testing (backend) | Vitest + Supertest | Fast, ESM-native, route integration testing |
| Testing (frontend) | Vitest + React Testing Library + Playwright (E2E) | Unit + component + critical flows |
| Password hashing | bcrypt (12 rounds) | Industry standard |

---

## Architecture Patterns

### Backend: Controller → Service → Repository

```
src/
├── controllers/     # Route handlers: parse, validate, delegate — no business logic
├── services/        # Business logic, domain rules — no HTTP, no ORM
├── repositories/    # Data access: all Prisma queries — no business logic
├── middleware/       # auth guard, error handler, request logger
├── lib/
│   ├── jwt.ts       # sign / verify JWT
│   └── hash.ts      # bcrypt helpers
└── index.ts         # Hono app entry point
```

**SOLID rules (see `backend/CLAUDE.md`):**
- Controllers depend on service interfaces, not concrete classes
- Services depend on repository interfaces, not Prisma directly
- Repository mocks are fully substitutable in tests

### Frontend: Feature-first

```
src/
├── app/                    # Next.js App Router pages (server components)
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── dashboard/page.tsx
│   ├── team/page.tsx       # Team lead only
│   └── layout.tsx
├── features/
│   ├── auth/
│   │   ├── components/     # LoginForm, RegisterForm
│   │   ├── hooks/          # useLogin, useRegister, useLogout
│   │   └── api.ts          # auth API client functions
│   ├── tasks/
│   │   ├── components/     # TaskList, TaskItem, TaskCreateForm, EmptyState
│   │   ├── hooks/          # useTasks, useCreateTask, useToggleTask, useDeleteTask
│   │   └── api.ts          # task API client functions
│   └── team/
│       ├── components/     # TeamOverview, MemberRow, MemberTaskList
│       ├── hooks/          # useTeamOverview
│       └── api.ts
└── shared/
    ├── components/         # Button, Input, Badge, Spinner, Toast
    ├── lib/
    │   └── api.ts          # Axios instance with baseURL + interceptors (401 → redirect)
    └── hooks/
        └── useAuth.ts      # reads JWT claims from cookie, returns current user
```

---

## Data Models

### User

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` | PK, `cuid()` | Distributed-safe ID |
| `email` | `String` | Unique, lowercase | Normalized on write |
| `password_hash` | `String` | — | bcrypt, never returned in API responses |
| `role` | `Enum` | `USER` \| `TEAM_LEAD` | Default: `USER` |
| `created_at` | `DateTime` | Default now | — |

### Task

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `String` | PK, `cuid()` | — |
| `user_id` | `String` | FK → User | Indexed |
| `title` | `String` | Max 200 chars | — |
| `due_date` | `DateTime?` | Nullable | Optional |
| `status` | `Enum` | `TODO` \| `DONE` | Default: `TODO` |
| `created_at` | `DateTime` | Default now | — |
| `deleted_at` | `DateTime?` | Nullable | Soft-delete |

**Indexes:** `user_id` (FK), `(user_id, deleted_at)` (list query), `due_date` (ordering)

---

## API Contract

| Method | Path | Auth | Request body | Response | Notes |
|---|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | None | `{ email, password }` | `{ data: { id, email, role } }` | Sets httpOnly cookie |
| `POST` | `/api/v1/auth/login` | None | `{ email, password }` | `{ data: { id, email, role } }` | Sets httpOnly cookie |
| `POST` | `/api/v1/auth/logout` | JWT | — | `{ data: null }` | Clears cookie |
| `GET` | `/api/v1/tasks` | JWT | — | `{ data: Task[] }` | Filtered to current user, ordered by due_date asc, undated last, done at bottom |
| `POST` | `/api/v1/tasks` | JWT | `{ title, due_date? }` | `{ data: Task }` | Creates with status `TODO` |
| `PATCH` | `/api/v1/tasks/:id/toggle` | JWT | — | `{ data: Task }` | Toggles `TODO` ↔ `DONE`. Ownership verified. |
| `DELETE` | `/api/v1/tasks/:id` | JWT | — | `{ data: null }` | Soft-delete. Ownership verified. |
| `GET` | `/api/v1/team/overview` | JWT + TEAM_LEAD | — | `{ data: TeamMember[] }` | Returns all users with task stats |
| `GET` | `/api/v1/team/members/:id/tasks` | JWT + TEAM_LEAD | — | `{ data: Task[] }` | Read-only task list for a team member |

**Response shape (all endpoints):**
- Success: `{ "data": <payload>, "error": null }`
- Error: `{ "data": null, "error": "<human-readable message>" }`

**HTTP status codes:**
- 200: success (GET, PATCH, DELETE)
- 201: resource created (POST register, POST tasks)
- 400: validation error
- 401: missing or invalid JWT
- 403: valid JWT but insufficient role
- 404: resource not found
- 409: conflict (duplicate email on register)

---

## Folder Structure (Full)

```
todoflow/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
│   │   │   ├── tasks.controller.ts
│   │   │   └── team.controller.ts
│   │   ├── services/
│   │   │   ├── auth.service.ts
│   │   │   ├── tasks.service.ts
│   │   │   └── team.service.ts
│   │   ├── repositories/
│   │   │   ├── user.repository.ts
│   │   │   └── task.repository.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts    # JWT verification → req.user
│   │   │   ├── role.middleware.ts    # TEAM_LEAD gate
│   │   │   └── error.middleware.ts   # Global error → { data: null, error: msg }
│   │   ├── lib/
│   │   │   ├── jwt.ts
│   │   │   └── hash.ts
│   │   └── index.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── tests/
│   │   ├── auth.test.ts
│   │   ├── tasks.test.ts
│   │   └── team.test.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── features/
│   │   └── shared/
│   ├── package.json
│   └── tsconfig.json
├── designs/
│   └── app.paper
├── CLAUDE.md
├── SPEC.md
├── PLAN.md
└── task.md
```

---

## Task Breakdown

| Tag | Task | Size |
|---|---|---|
| `[backend]` | Set up Hono app, Prisma schema, and DB connection | S |
| `[backend]` | `POST /api/v1/auth/register` — validate, hash password, create user, issue JWT cookie | M |
| `[backend]` | `POST /api/v1/auth/login` — validate credentials, issue JWT cookie | S |
| `[backend]` | `POST /api/v1/auth/logout` — clear JWT cookie | XS |
| `[backend]` | `GET /api/v1/tasks` — fetch user's non-deleted tasks, ordered by due_date | S |
| `[backend]` | `POST /api/v1/tasks` — validate + create task for current user | S |
| `[backend]` | `PATCH /api/v1/tasks/:id/toggle` — toggle status, verify ownership | S |
| `[backend]` | `DELETE /api/v1/tasks/:id` — soft-delete, verify ownership | S |
| `[backend]` | `GET /api/v1/team/overview` + `GET /api/v1/team/members/:id/tasks` — TEAM_LEAD only | M |
| `[frontend]` | Set up Next.js project, Tailwind, React Query, API client (`shared/lib/api.ts`) | S |
| `[frontend]` | Register page — `RegisterForm` component, `useRegister` hook | M |
| `[frontend]` | Login page — `LoginForm` component, `useLogin` hook | M |
| `[frontend]` | Dashboard page — `TaskList`, `TaskItem`, `TaskCreateForm`, `EmptyState` | L |
| `[frontend]` | Task toggling — `useToggleTask` hook with optimistic update | S |
| `[frontend]` | Task deletion — `useDeleteTask` hook with undo toast | M |
| `[frontend]` | Team overview page — `TeamOverview`, `MemberRow`, `MemberTaskList` | M |
| `[frontend]` | Auth guard — redirect unauthenticated users from `/dashboard` and `/team` | S |
| `[qa]` | Backend: auth routes — register (happy path, duplicate email, weak password), login (valid, invalid), logout | M |
| `[qa]` | Backend: task routes — CRUD + ownership enforcement + soft-delete | M |
| `[qa]` | Backend: team routes — TEAM_LEAD access, regular user 403 | S |
| `[qa]` | Frontend: `TaskItem` component — renders title, due date, overdue state, done state | S |
| `[qa]` | Frontend: `TaskCreateForm` — validation (empty title, past due date) | S |
| `[qa]` | E2E: register → create task → toggle done → delete (Playwright) | M |

---

## Open Questions

| Question | Proposed default | Status |
|---|---|---|
| Should the backend be a monorepo or separate repo? | Monorepo in `/backend` and `/frontend` subdirs | Decided |
| Polling interval for task list refresh? | 30s via React Query `refetchInterval` | Decided |
| JWT secret storage on Railway? | Railway environment variable `JWT_SECRET` | Decided |
| Should the Prisma client be a singleton or instantiated per request? | Singleton (standard Prisma pattern) | Decided |

# Example: TodoFlow

A complete set of workflow artifacts for a simple todo app built with Next.js, Hono, Prisma, and PostgreSQL. This example was produced by running the workflow in **Full mode** (all 6 phases).

---

## What this example teaches

| Artifact | What to look for |
|---|---|
| [SPEC.md](SPEC.md) | How to scope a v1: clear "Out of Scope" list, concrete acceptance criteria per story, explicit technical constraints |
| [PLAN.md](PLAN.md) | How to make stack decisions (with rationale), API contract table, data model table, task breakdown with tags and size estimates |
| [task.md](task.md) | How tasks are grouped (parallel vs sequential), how blocking is documented, what a near-complete task list looks like |
| [walkthrough.md](walkthrough.md) | What the `/validate` output looks like: QA runner fixes, security audit with severity levels, visual conformance per screen |

---

## The project

**TodoFlow** — a lightweight task manager for remote teams.

- Email/password auth with JWT httpOnly cookies
- Per-user task lists with soft-delete and due date ordering
- Team lead overview showing all members' tasks
- Mobile-first, responsive UI

**Stack:** Next.js 14 (App Router) + Hono + Prisma + PostgreSQL + Tailwind v4 + React Query v5

---

## Mode used: Full

```
Antigravity → SPEC.md
Paper MCP   → designs/app.paper  (6 screens)
/plan       → PLAN.md + task.md
/build      → implementation (backend + frontend in parallel subagents)
/validate   → walkthrough.md + QA report + security audit + visual report
/ship       → PR #1 — feat: implement TodoFlow v1
```

---

## What this example does NOT include

- Source code — this is planning/documentation artifacts only
- Paper design file — open `designs/app.paper` in a real project with the Paper MCP
- Git history — this is a static snapshot

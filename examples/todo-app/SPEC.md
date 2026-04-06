# SPEC — TodoFlow

## Problem

Remote teams struggle to track daily tasks and handoff progress. Existing tools (Jira, Asana) are too heavy for individual contributors managing personal workloads. People fall back to sticky notes, lost in Slack threads.

**We need:** a lightweight, fast todo app with per-user lists, real-time status tracking, and a clean mobile-first interface.

---

## User Personas

| Persona | Description | Key need |
|---|---|---|
| **Individual contributor** | Developer or designer managing their own task list | Fast capture, minimal friction |
| **Team lead** | Person overseeing 3–6 contributors | Visibility into team progress without micromanagement |

---

## User Stories

### Feature Area: Authentication

**Story A1** — Register
As an individual contributor, I want to create an account with email and password so that my tasks are private and persistent.

Acceptance criteria:
- [ ] Email must be unique — duplicate registration returns a clear error message
- [ ] Password must be ≥ 8 characters — weaker passwords rejected with a message
- [ ] On success: user is logged in and redirected to their empty task list
- [ ] Password is stored as a bcrypt hash — never in plaintext

**Story A2** — Log in
As an individual contributor, I want to log in with my email and password so that I can access my tasks on any device.

Acceptance criteria:
- [ ] Valid credentials → JWT issued, stored in httpOnly cookie
- [ ] Invalid credentials → "Invalid email or password" (same message for both cases — no enumeration)
- [ ] JWT expires after 7 days — user must re-authenticate after expiry

**Story A3** — Log out
As an individual contributor, I want to log out so that my session is cleared on shared devices.

Acceptance criteria:
- [ ] Logout clears the JWT cookie
- [ ] After logout, accessing `/dashboard` redirects to `/login`

---

### Feature Area: Task Management

**Story B1** — Create task
As an individual contributor, I want to add a task with a title and optional due date so that I can track what I need to do.

Acceptance criteria:
- [ ] Title is required (max 200 characters)
- [ ] Due date is optional — if set, must be today or future
- [ ] Task is created with status `todo` and assigned to the logged-in user
- [ ] New task appears at the top of the list immediately

**Story B2** — View task list
As an individual contributor, I want to see all my tasks ordered by due date (soonest first, undated last) so that I know what to focus on today.

Acceptance criteria:
- [ ] Shows all non-deleted tasks owned by the logged-in user
- [ ] Overdue tasks (past due date, not done) highlighted visually
- [ ] Empty state: "No tasks yet — add your first one" with a CTA

**Story B3** — Complete task
As an individual contributor, I want to mark a task as done so that I can track my progress.

Acceptance criteria:
- [ ] Clicking the checkbox toggles status between `todo` and `done`
- [ ] Done tasks are visually distinct (strikethrough + muted color)
- [ ] Done tasks move to the bottom of the list

**Story B4** — Delete task
As an individual contributor, I want to delete a task so that I can remove items that are no longer relevant.

Acceptance criteria:
- [ ] Requires confirmation (undo toast or confirmation dialog)
- [ ] Soft-deleted in DB (`deleted_at` timestamp) — not hard-deleted
- [ ] Task disappears from the list immediately after deletion

---

### Feature Area: Team Visibility (Team Lead only)

**Story C1** — View team overview
As a team lead, I want to see all tasks across my team members so that I can track overall progress.

Acceptance criteria:
- [ ] Team lead role required — regular users cannot access this view
- [ ] Shows each team member's name, total tasks, completed count, overdue count
- [ ] Clicking a team member expands their full task list (read-only)

---

## Out of Scope

- Task editing after creation (v2 feature)
- Task comments or attachments
- Notifications or reminders
- OAuth / social login (email + password only for v1)
- Mobile native apps (web only, mobile-first responsive)
- Real-time collaboration (polling every 30s is acceptable for v1)
- Task assignment (users can only see their own tasks, except team leads)

---

## Technical Constraints

| Constraint | Requirement |
|---|---|
| Hosting | Vercel (frontend) + Railway (backend + PostgreSQL) |
| Auth | JWT in httpOnly cookie — no localStorage |
| Budget | Free tier only |
| Performance | Task list must load in < 500ms on a standard 4G connection |
| Browser support | Chrome 120+, Safari 17+, Firefox 121+ |

---

## Technical Patterns

- **Backend architecture**: Controller → Service → Repository (SOLID, as defined in `backend/CLAUDE.md`)
- **Frontend architecture**: Feature-first folders (`features/auth/`, `features/tasks/`, `shared/components/`)
- **No SSR for authenticated routes**: all task data fetched client-side with React Query (avoids caching complexity for v1)
- **Soft-delete**: all task records use `deleted_at` — no hard deletes

---

## Success Metrics

1. A new user can register and add their first task in under 60 seconds from landing on the app
2. Task list loads in < 500ms for a user with up to 100 tasks
3. Zero authentication bypass vulnerabilities (confirmed by security audit)

---

## Open Questions

| Question | Proposed default |
|---|---|
| Should team leads be assigned explicitly (admin action) or self-assign? | Admin assigns — simpler to implement, reduces permission creep |
| Should done tasks be permanently hidden or visible in a "done" filter? | Visible but visually distinct — moved to bottom of list |
| Session duration: 7 days or 30 days? | 7 days — more secure for v1, revisit with "remember me" in v2 |

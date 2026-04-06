---
description: Phase 1 — interactive ideation session that produces SPEC.md (Claude Code alternative to Antigravity)
argument-hint: "<idea or problem description>"
---

# /ideate <idea>

Run a structured ideation session directly in Claude Code and produce a complete `SPEC.md` ready for `/plan`.

Use this when you don't have Antigravity or prefer to run ideation inside Claude Code. The output is the same artifact — a structured `SPEC.md` that every subsequent agent reads for the life of the project.

## Argument

- `<idea>` — your raw idea, problem statement, or one-line description. Can be rough.
  - Minimal: `/ideate "todo app"`
  - Better: `/ideate "a task manager for remote teams with per-user lists and a team lead overview"`
  - Detailed: `/ideate "I want to build a SaaS tool where freelance designers submit invoices to clients who can approve or dispute them, with Stripe integration"`

---

## Phase A — Context loading

1. Read `templates/SPEC.template.md` — internalize all required sections and their purpose
2. Read `examples/todo-app/SPEC.md` — calibrate the expected level of detail for acceptance criteria, out-of-scope items, and success metrics. This is the quality bar.
3. Check if `SPEC.md` already exists at the project root:
   - If yes: say "SPEC.md already exists. Choose: (1) overwrite it for a new project, (2) append a new feature section, or (3) abort." Wait for the user's choice before continuing.
   - If no: continue.
4. Analyze the user's argument. Identify which of the 5 discovery areas below are already answered in the description and which are missing.

---

## Phase B — Discovery

Ask **only** the questions that are NOT already answered by the user's initial description. Group all unanswered questions into a **single message** — never ask them one at a time.

Use this exact framework — include only the numbered items that are still missing:

---

> Before I write your SPEC.md, I need a few things to make the acceptance criteria concrete and the scope boundaries sharp.

**1 — Users + problem** *(ask if not answered)*
Who uses this? Be specific — not "developers" but "frontend developers at agencies managing 5+ client projects at once". What is their actual pain point? What frustrating thing are they doing today that your app replaces or eliminates?

**2 — Core user actions** *(ask if not answered)*
List the 3–5 most important things a user can DO with this app. Think in verbs: "create a task", "share a report link", "approve an invoice". These become your user stories.

**3 — Hard out-of-scope** *(ask if not answered)*
What are you NOT building in v1? Name at least 3 things you're explicitly deferring to v2. This list is what prevents agents from over-building.

**4 — Constraints** *(ask if not answered)*
Any hard constraints? Answer what applies:
- Hosting: (Vercel / Railway / AWS / self-hosted / no preference)
- Budget: (free tier only / $X/month max / no constraint)
- Integrations: (must connect to Stripe, Slack, an existing DB, etc. / none)
- Performance: (specific load time or concurrency target / no requirement)
- Auth: (email+password only / must support OAuth / no preference)

**5 — Success definition** *(ask if not answered)*
How will you know this worked? Give 1–3 measurable outcomes. Examples: "a new user can complete the main flow in under 2 minutes", "task list loads in < 500ms for 100 items", "passes a security audit with zero high-severity findings".

---

Wait for the user's answers. Then proceed to Phase C.

If the user's initial description already answers 4 or 5 of these areas clearly, skip Phase B entirely and go directly to Phase C — note that you are doing so.

---

## Phase C — Synthesis

Using the user's initial description and their Phase B answers, draft a complete SPEC.md.

**Quality bar — every section must meet this standard:**

| Section | Minimum quality |
|---|---|
| Problem statement | One paragraph. Names the specific user. Describes the exact pain. Explains why it matters. |
| User personas | 1–3 rows. Not "admin / user" — specific named roles with specific needs (reference `examples/todo-app/SPEC.md`). |
| User stories | Grouped by feature area. "As a [specific persona], I want to [action] so that [benefit]." Each story has ≥ 2 acceptance criteria. Criteria are testable: "returns 401 with message 'Invalid credentials'" not "handles errors correctly". |
| Out of scope | Minimum 4 items. Each is a real feature a naive agent might build — specific enough to prevent scope creep. |
| Technical constraints | All 5 fields present (hosting, database, auth, budget, performance). Use "no preference" rather than leaving blank. |
| Technical patterns | Fill from user input or use the defaults from `backend/CLAUDE.md` and `frontend/CLAUDE.md`. Note any deviation. |
| Success metrics | 2–3 items. Every item is measurable (time, percentage, specific behavior). |
| Open questions | Minimum 2 rows. Every question has a proposed default (so `/plan` is never blocked waiting for a decision). |

**Inference rules (when information was not provided):**
- Hosting: propose "no preference — recommend Vercel + Railway for zero-config deployment"
- Auth: propose "email + password with JWT unless user explicitly needs OAuth"
- Database: propose "PostgreSQL — relational, widely supported, Railway-native"
- Missing acceptance criteria: write the most conservative testable version and flag it with `<!-- inferred — confirm -->`
- Missing out-of-scope items: infer the most obvious v2 features and add them with a note

---

## Phase D — Review

Present the full SPEC.md draft as a markdown code block.

Then say:

> Review this draft. Tell me:
> - Anything to change, add, or remove
> - Any acceptance criteria that feel too vague or too strict
> - Any missing feature areas you want to add
> - Any out-of-scope items that are actually in scope
>
> When you're satisfied, say **"approve"** and I'll write the file.
> If you have no changes, you can also say **"approve"** now.

Apply any changes the user requests. If significant sections changed, re-present the relevant portions. For minor wording changes, apply them and confirm without re-presenting the whole document.

Wait for explicit approval ("approve", "looks good", "write it", "go ahead", or equivalent) before writing.

---

## Phase E — Write

When the user approves:

1. Write the complete SPEC.md to the project root
2. Verify the file was written completely (read it back — confirm no sections are missing or truncated)

---

## Done

Report:

- `SPEC.md` written ✓
- Summary: [problem area], [N] user personas, [N] stories across [N] feature areas, [N] out-of-scope items, [N] open questions
- Flagged sections: list any sections where inference was heavy — marked `<!-- inferred — confirm -->` in the file
- **Next step:** Run `/plan` to generate `PLAN.md`, stack decisions, and a tagged `task.md`.

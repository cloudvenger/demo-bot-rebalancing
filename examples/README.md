# Workflow Examples

Concrete, end-to-end examples showing what each workflow artifact looks like in practice.

Each example is a complete set of the documents produced by the workflow phases — not a tutorial, but a reference. Use them to calibrate your own artifacts: if your SPEC.md looks roughly like the example SPEC.md, you're in the right shape.

---

## Examples

| Example | Mode | Stack | What it demonstrates |
|---|---|---|---|
| [todo-app/](todo-app/) | Full | Next.js + Prisma + PostgreSQL + Tailwind | Complete 6-phase run: SPEC → PLAN → task.md → walkthrough |

---

## How to use these examples

**Before writing your SPEC.md:** Read `todo-app/SPEC.md` to see the level of detail and structure expected.

**Before running `/plan`:** Read `todo-app/PLAN.md` to understand how architecture decisions are documented and how task tagging works.

**Before running `/build`:** Read `todo-app/task.md` to see how tasks are sized, tagged, and tracked.

**After `/validate`:** Read `todo-app/walkthrough.md` to see the expected format for the validation artifact.

---

## What is NOT in these examples

- Working source code — these are planning and documentation artifacts, not implementations
- Paper design files — design files live in `designs/` and require the Paper MCP to open
- Git history — each example is a snapshot, not a version-controlled project

---

## Adding your own examples

If you build something with this workflow and want to contribute the artifacts as an example, open a PR adding a new subdirectory under `examples/` with the same structure: `SPEC.md`, `PLAN.md`, `task.md`, `walkthrough.md`, and a `README.md` explaining the project.

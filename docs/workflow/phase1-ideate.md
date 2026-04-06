# Phase 1 — Ideation & Product Definition

**Tool: Antigravity — or `/ideate` (Claude Code native)**

This phase transforms a raw idea into a structured, machine-readable specification that AI agents can consume.

## Two paths to SPEC.md

### Path A — Antigravity (recommended for deep ideation)
Use when you want a dedicated ideation session outside Claude Code: richer back-and-forth, business model exploration, user research framing.

1. Describe your idea to Antigravity in natural language
2. Antigravity asks clarifying questions: Who is the user? What problem does it solve? What are the constraints?
3. Antigravity produces a structured product spec
4. Save the output as `SPEC.md` at the project root

### Path B — `/ideate` (Claude Code native)
Use when you want to stay inside Claude Code, move fast, or don't have Antigravity access.

```
/ideate "a task manager for remote teams with per-user lists and a team lead overview"
```

Claude runs a structured discovery interview (5 questions, asked in one batch), drafts SPEC.md, asks for your review, and writes the file when you approve. The output is the same artifact — ready for `/plan`.

**When to choose which:**

| Situation | Use |
|---|---|
| New project, exploring the idea space | Antigravity |
| Idea is already clear, want to move fast | `/ideate` |
| No Antigravity access | `/ideate` |
| Adding a new feature to an existing project | Append to existing `SPEC.md` manually, or `/ideate` with option 2 (append) |

## What SPEC.md must contain
- **Problem statement**: one paragraph describing the user problem being solved
- **User stories**: written as "As a [persona], I want to [action] so that [benefit]"
- **Acceptance criteria**: per story, the conditions that must be true for the story to be complete
- **Out of scope**: explicit list of what is NOT being built in this iteration
- **Technical constraints**: known limitations (budget, existing systems, required integrations)

## Template
A ready-to-use template is available at [`templates/SPEC.template.md`](../../templates/SPEC.template.md). Copy it to your project root as `SPEC.md` and fill in each section.

## Deliverable
`SPEC.md` — approved by the human before Phase 2 begins.

## Why this matters
Every agent spawned throughout the project reads `CLAUDE.md`, which references `SPEC.md`. Without this file, agents have no context for *what* they are building. With it, a backend agent generating an API route and a frontend agent building a component both understand the same product intent.

## Intra-phase iteration
```
Describe idea → Antigravity asks questions → refine → repeat until SPEC.md is solid
```
The human checkpoint at the end of this phase is the exit condition. Until the human approves `SPEC.md`, the phase loops.

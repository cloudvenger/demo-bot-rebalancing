# Product Specification — workflow-dev-ia NEXUS Improvements

> Improvements inspired by analysis of [agency-agents / NEXUS](https://github.com/msitarzewski/agency-agents) and its strategy layer.
> Scope: workflow docs, skill files, and agent files only — no code, no new tooling.

---

## Problem Statement

workflow-dev-ia defines a solid 6-phase loop with skills, agents, and a deliverable chain. But it is silent at the boundaries between phases. Agents know what to build but not how to signal completion with evidence, not what format to use when handing off to the next agent, and not what to do when they are stuck. The result: phase transitions rely on implicit trust ("the agent probably did it right"), multi-agent coordination fails silently, and blocked tasks have no resolution path. This spec closes those gaps by borrowing the protocol clarity of NEXUS while preserving what workflow-dev-ia does better.

---

## User Personas

| Persona | Description | Key needs |
|---|---|---|
| Solo developer | Single dev using Claude Code and the workflow alone | Knows which mode to use, knows when a phase is truly done |
| Team lead | 2-4 devs coordinating through shared task.md and agents | Consistent handoff format so agents don't start cold |
| Template adopter | Someone who cloned the template and adapted it to their stack | Clear escalation path when something is blocked |

---

## User Stories

### Track A — Quality gate criteria

- [x] As a developer, I want each phase to have explicit pass/fail criteria so that I know with certainty when it is safe to advance to the next phase.
  - **Acceptance criteria:**
    - [x] phase4-build.md has a gate table: criterion, threshold, how to verify
    - [x] phase5-validate.md has a gate table: criterion, threshold, how to verify
    - [x] phase6-ship.md has a gate table: criterion, threshold, how to verify
    - [x] Each gate names a gate keeper (human, or which skill/agent verifies)
    - [x] Each gate defines what "gate fails" means and where to return

- [x] As a developer, I want the architect phase to have an exit gate so that PLAN.md and task.md are verified complete before build begins.
  - **Acceptance criteria:**
    - [x] phase3-architect.md has a gate table
    - [x] Gate includes: all TBD stack placeholders resolved, task.md covers 100% of SPEC.md user stories, PLAN.md has API contract and component map

### Track B — Handoff templates

- [x] As a build orchestrator, I want a standard format for assigning a task to an agent so that the agent never starts cold.
  - **Acceptance criteria:**
    - [x] `docs/workflow/handoff-templates.md` exists
    - [x] Template 1 (task assignment) covers: task ID, acceptance criteria, relevant file paths, scope boundaries, who receives the output
    - [x] Template is referenced from the `/build` skill

- [x] As a QA agent, I want a standard format for reporting a PASS so that the orchestrator can advance unambiguously.
  - **Acceptance criteria:**
    - [x] Template 2 (QA PASS) covers: task ID, evidence checklist, acceptance criteria status, next action
    - [x] Template is referenced from the qa-runner agent

- [x] As a QA agent, I want a standard format for reporting a FAIL so that the developer agent knows exactly what to fix without ambiguity.
  - **Acceptance criteria:**
    - [x] Template 3 (QA FAIL) covers: each issue with expected/actual/file:line/fix instruction, acceptance criteria status, attempt count, retry instructions
    - [x] Template is referenced from the qa-runner agent

- [x] As a developer agent, I want a standard escalation format so that when 3 retries are exhausted the human receives a structured, actionable report.
  - **Acceptance criteria:**
    - [x] Template 4 (escalation) covers: failure history per attempt, root cause analysis, resolution options (decompose / revise approach / defer / accept), impact on other tasks
    - [x] Template is referenced from the `/build` skill escalation section

### Track C — Three operating modes

- [x] As a new user, I want to know immediately which phases to run for my project size so I do not run a 6-phase process for a 30-minute bug fix.
  - **Acceptance criteria:**
    - [x] `docs/workflow/modes.md` exists with three modes: Full, Sprint, Micro
    - [x] Each mode defines: when to use it, which skills to run, which phases to skip
    - [x] Full = new project from scratch (all 6 phases)
    - [x] Sprint = adding a feature (skip phases 1-2, start at `/plan`)
    - [x] Micro = single targeted change (skip planning, use gen-* or add-test directly)

- [x] As a user reading `/help`, I want the three modes presented as the first decision so I can orient immediately.
  - **Acceptance criteria:**
    - [x] The help skill presents the mode selection before the phase overview
    - [x] Each mode links to its relevant skills in a copy-pasteable sequence

- [x] As a new user visiting the README, I want a "Choose Your Mode" section before the quickstart so that I start with the right scope from the very first step.
  - **Acceptance criteria:**
    - [x] README.md has a "Choose Your Mode" section inserted before the existing 6-step quickstart
    - [x] Section presents Full / Sprint / Micro with a one-line description and the exact skill sequence for each
    - [x] The existing 6-step quickstart is preserved below it (it becomes the Full mode detail)

### Track D — Dev↔QA loop in `/build`

- [x] As a developer, I want an optional strict mode in `/build` that validates each task before moving to the next so that failures don't compound across an entire parallel batch.
  - **Acceptance criteria:**
    - [x] `/build` skill documents a `--strict` flag
    - [x] Strict mode: spawn developer agent for task N → spawn qa-runner for task N → PASS advance / FAIL retry (max 3) → 3 failures escalate
    - [x] Default (parallel) mode is unchanged — `--strict` is permanently opt-in, never becomes the default
    - [x] Strict mode documentation says when to use it: critical path features, auth/payments, prior build had cascading failures

### Track E — Escalation protocol in `/build`

- [x] As a developer using `/build`, I want a documented protocol for blocked tasks so that I always know what to do next instead of being stuck.
  - **Acceptance criteria:**
    - [x] `/build` skill has an explicit "When a task is blocked" section
    - [x] Protocol covers: check dependency ordering → retry with more context → emit escalation template → annotate task.md with `[blocked: reason]` → continue unblocked tasks
    - [x] Protocol states: a phase with blocked tasks cannot pass its exit gate
    - [x] Protocol references the escalation template from handoff-templates.md

---

## Out of Scope

- NEXUS marketing, launch, and operations phases (Phase 5 and 6 in NEXUS)
- Finance Tracker, Legal Compliance Checker, Analytics Reporter, Executive Summary Generator agents
- Hundred-agent orchestration or NEXUS Coordination Matrix
- Multi-tool conversion scripts (separate initiative)
- Enriching agent persona depth (separate initiative)
- Adding accessibility and performance agents (separate initiative)
- Any changes to source code, tests, or build tooling — this spec is documentation and skill files only

---

## Technical Constraints

- All new files must live in `docs/workflow/` or `.claude/skills/` or `.claude/agents/`
- No new dependencies — markdown only
- All new skill content must follow the existing SKILL.md frontmatter format
- Handoff templates must use the same markdown conventions as the rest of `docs/workflow/`
- No changes to CLAUDE.md files at root, backend, frontend, or contracts level
- The default behavior of all existing skills must remain unchanged — new behavior is additive only

---

## Technical Patterns

- New docs follow the `docs/workflow/` split-file pattern (one topic per file)
- New skill sections are appended to existing SKILL.md files, not new files
- Gate criteria tables use the 3-column format: Criterion | Threshold | How to verify
- Handoff templates use fenced markdown code blocks so they can be copy-pasted into agent prompts
- The modes.md file is a single-page reference, not a deep tutorial

---

## Success Metrics

- A developer reading phase4-build.md can answer "am I done with build?" with a yes/no, not a judgment call
- An agent reading the `/build` skill knows exactly what to emit when a task fails for the third time
- A new user reading `/help` can identify their operating mode in under 30 seconds
- The handoff-templates.md file is referenced from at least the `/build` skill and the qa-runner agent
- No existing skill behavior is broken — all changes are additive

---

## Open Questions

| Question | Decision | Status |
|---|---|---|
| Should `--strict` mode eventually become the default for `/build`? | No — parallel stays default permanently, `--strict` is opt-in | Decided |
| Should modes.md also update the README quickstart section? | Yes — add a "Choose Your Mode" section before the 6-step quickstart | Decided |
| Should the phase gate tables live in the phase docs or in a single `gates.md`? | In each phase doc — co-located with phase context | Decided |
| Should handoff templates be in docs/workflow/ or embedded in the skill files themselves? | `docs/workflow/handoff-templates.md` — single source of truth, referenced from skills | Decided |
| Should the escalation template trigger a `/check` automatically or require human confirmation? | Human confirmation required — blocked tasks are structurally ambiguous, human decides next action | Decided |

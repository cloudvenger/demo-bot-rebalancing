# Phase 3 — Architecture & Planning

**Tool: Claude Code (Plan Mode) + Explore Subagent**

This phase converts the spec and design into a concrete technical plan.

## What happens
1. User runs `/plan` in Claude Code
2. An **Explore subagent** scans the existing codebase for patterns, installed dependencies, and constraints — informing the architecture before any decisions are made
3. Claude Code reads `SPEC.md` and all Paper design screens
4. Claude Code proposes: stack, architecture patterns, data models, API contract, folder structure
5. Claude Code writes `PLAN.md` using `templates/PLAN.template.md`
6. Claude Code fills in the `TBD` sections in all `CLAUDE.md` files
7. Claude Code writes `task.md` — one checkbox per task, each tagged with the responsible team agent:
   ```
   - [ ] [backend]   Create POST /api/v1/users endpoint with validation
   - [ ] [frontend]  Build UserCard component from the Paper design
   - [ ] [qa]        Write tests for POST /api/v1/users
   - [ ] [contracts] Deploy Registry contract to Sepolia
   ```
8. User reviews and approves the plan

## What PLAN.md must contain
- **Stack decisions**: framework, database, ORM, auth, styling — with rationale
- **Architecture patterns**: one named pattern per layer with rationale:
  - Backend: Controller → Service → Repository / Hexagonal (Ports & Adapters) / CQRS
  - Frontend: Feature-first folders / Atomic Design / Smart-Presentational split
  - Contracts (if in scope): Immutable / UUPS proxy / Transparent proxy / Diamond (EIP-2535)
- **Data models**: entity names, key fields, relationships
- **API contract**: list of endpoints with HTTP method, path, request/response shape
- **Folder structure**: annotated directory tree
- **Open questions**: anything not yet decided, with a proposed default

## Why architecture patterns must be named explicitly
Without a named pattern, each sub-agent makes a local structural decision. Over 10 tasks you end up with 3 different ways business logic is structured. A named pattern is a shared contract: every agent building the same layer produces compatible code.

## Task tags — why they matter

Each task in `task.md` has exactly one tag: `[backend]`, `[frontend]`, `[contracts]`, or `[qa]`. These tags are consumed by `/build` to route each task to the correct team agent with the correct CLAUDE.md context. Without tags, `/build` cannot automatically parallelize work across agents.

Rules for tagging:
- One task = one tag. If a task needs two agents, split it into two tasks.
- `[qa]` tasks always follow the implementation task they test.
- Tasks modifying shared types get the tag of the layer that owns the type.

## Deliverable
`PLAN.md` + `task.md` (tagged) + updated `CLAUDE.md` files — approved by the human.

## Why this phase cannot be skipped
Without a plan, agents make incompatible local decisions: the backend builds one data shape, the frontend expects another, the contracts have no registry even though multiple services need to discover each other. The plan is the contract between all agents.

## Intra-phase iteration
```
Propose plan → human review → "change the auth strategy" → revise → repeat until approved
```

---

## Exit Gate — Phase 3 → 4

| Criterion | Threshold | How to verify |
|---|---|---|
| All TBDs resolved in CLAUDE.md files | 0 remaining `TBD` values | `grep -r "TBD" CLAUDE.md backend/CLAUDE.md frontend/CLAUDE.md contracts/CLAUDE.md` |
| PLAN.md contains all required sections | Stack, architecture patterns, data models, API contract, folder structure, task breakdown | Manual review against `templates/PLAN.template.md` |
| task.md covers 100% of SPEC.md user stories | Every user story has ≥ 1 task | Cross-reference task.md with SPEC.md user stories |
| All tasks in task.md are tagged | 0 untagged tasks | Every `- [ ]` line has a `[tag]` |
| Human has approved PLAN.md | Verbal or written approval | Human sign-off before Phase 4 begins |

Gate fails → revise PLAN.md, re-run relevant parts of `/plan`, repeat.

# Product Specification

> Copy this file to your project root as `SPEC.md` and fill in each section.

---

## Problem Statement

<!-- One paragraph: who is the user, what problem do they have, why does it matter? -->

[Describe the core problem your application solves. Be specific about the user and their pain point.]

---

## User Personas

| Persona | Description | Key needs |
|---|---|---|
| [e.g., Admin] | [Who they are, what they do] | [What they need from this app] |
| [e.g., End User] | [Who they are, what they do] | [What they need from this app] |

---

## User Stories

### [Feature area 1: e.g., Authentication]

- [ ] As a [persona], I want to [action] so that [benefit].
  - **Acceptance criteria:**
    - [ ] [Condition that must be true for this story to be complete]
    - [ ] [Another condition]

- [ ] As a [persona], I want to [action] so that [benefit].
  - **Acceptance criteria:**
    - [ ] [Condition]

### [Feature area 2: e.g., Dashboard]

- [ ] As a [persona], I want to [action] so that [benefit].
  - **Acceptance criteria:**
    - [ ] [Condition]

### [Feature area 3: e.g., Settings]

- [ ] As a [persona], I want to [action] so that [benefit].
  - **Acceptance criteria:**
    - [ ] [Condition]

---

## Out of Scope

> Explicit list of what is NOT being built in this iteration. This prevents agents from over-building.

- [Feature or capability that is explicitly deferred]
- [Another thing not in scope]
- [Another thing not in scope]

---

## Technical Constraints

> Known limitations, required integrations, budget constraints, or technology preferences.

- **Hosting**: [e.g., must run on Vercel / AWS / self-hosted]
- **Database**: [e.g., must use PostgreSQL / no preference]
- **Auth**: [e.g., must support OAuth with Google / no preference]
- **Budget**: [e.g., free tier only / $X/month max]
- **Existing systems**: [e.g., must integrate with Stripe API / none]
- **Performance**: [e.g., must load in under 2s / no specific requirement]

---

## Technical Patterns

> Preferred architecture patterns per layer. These inform Phase 3 (`/plan`) decisions. Leave blank if no preference.

- **Backend pattern**: [e.g., Controller → Service → Repository / Hexagonal / CQRS / no preference]
- **Frontend structure**: [e.g., Feature-first folders / Atomic Design / no preference]
- **Smart contract upgradeability** *(if applicable)*: [e.g., Immutable / UUPS / Transparent proxy / no preference]
- **Smart contract factory** *(if applicable)*: [e.g., Yes — multiple instances per user / No]
- **Smart contract registry** *(if applicable)*: [e.g., Yes — dynamic address resolution / No]

---

## Success Metrics

> How do you know the project succeeded? Define 1-3 measurable outcomes.

- [e.g., User can sign up and complete the main flow in under 3 minutes]
- [e.g., All API responses return in under 200ms]
- [e.g., App passes all accessibility checks (WCAG 2.1 AA)]

---

## Open Questions

> Anything not yet decided. Each should have a proposed default so work is not blocked.

| Question | Proposed default | Status |
|---|---|---|
| [e.g., Which payment provider?] | [Stripe] | [Open / Decided] |
| [e.g., Support mobile?] | [Web-first, responsive] | [Open / Decided] |

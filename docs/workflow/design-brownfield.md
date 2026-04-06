# Design — Brownfield

When modifying an existing application, you do not run Phase 1–2 sequentially. You enter the workflow at the point of change and work from what already exists.

This document covers the full brownfield design workflow: auditing the current UI, anchoring the agent to existing components and tokens, scoping changes, and verifying outputs visually.

---

## Entry points

| Situation | Where you enter |
|---|---|
| Adding a new screen to an existing app | Phase 2 design → Phase 3 plan → Phase 4 build |
| Modifying an existing screen | Phase 4 directly, design audit first |
| Full UI redesign of an existing app | Phase 2 (design audit + rebuild) → Phase 3 → Phase 4 |
| Fixing a visual bug | Phase 4 directly, round-trip screenshot loop |

---

## Step 1 — Audit the existing design system

Before touching any design file or writing any code, document what already exists.

**If a design file exists (`designs/app.paper` or `designs/app.pen`):**
```
# Paper
get_computed_styles → extract current colors, spacing, typography

# Pencil
search_all_unique_properties → extract all unique token values across the canvas
```

**If no design file exists (legacy app):**
1. Screenshot every existing screen
2. Pass screenshots to Claude: *"Extract the color palette, spacing scale, typography system, and component inventory from these screenshots."*
3. Claude produces a structured token file — save it as `designs/tokens-audit.md`
4. Use this as the baseline for all new design work

Record the audit in `designs/tokens-audit.md`:
```
Colors:    primary #hex, surface #hex, text #hex, border #hex
Spacing:   4 / 8 / 16 / 24 / 32 / 48px
Typography: heading [family] [sizes], body [family] [sizes]
Components: Button, Card, Input, Modal, Nav — see src/components/
```

---

## Step 2 — Map design components to code

The single highest-leverage step. Without this mapping, agents generate duplicate components instead of using what already exists.

Create or update `src/components/README.md`:
```
## Component inventory

| Design node | File | Props |
|---|---|---|
| PrimaryButton | src/components/Button.tsx | variant, size, disabled |
| CardContainer | src/components/Card.tsx | title, children, footer |
| TextInput | src/components/Input.tsx | label, placeholder, error |
| PageHeader | src/components/layout/PageHeader.tsx | title, breadcrumb |
```

Every agent working on UI reads this file before generating any component. It prevents hallucination of duplicates.

---

## Step 3 — Import the existing UI into the design tool

**Pencil:** Paste Figma frames directly into Pencil — layers, auto-layout, and styles are preserved. This is the primary brownfield entry point for teams with existing Figma files.

**Paper:** Use `write_html` with extracted HTML from the live app as the starting point:
1. Inspect the existing screen in the browser (copy the relevant HTML)
2. Agent calls `create_artboard` + `write_html` with the extracted markup
3. The existing UI is now on canvas and can be modified alongside new work

**No Figma, no live app:** Use the token audit from Step 1 as the design brief. Generate the new screen from scratch using the audited tokens — it will be visually consistent with the existing app even without a reference file.

---

## Step 4 — Scope the change strictly

Give agents one screen or one component per session. Brownfield context is large; narrow scope produces better outputs.

**Rules:**
- Never redesign screens you are not changing
- Do not refactor components outside the stated scope
- Do not update tokens unless the task explicitly requires it

**Before every agent session, state the scope explicitly:**
```
Scope: Dashboard screen only.
Do not touch: Login, Settings, or any shared components outside DashboardCard.
Existing component map: src/components/README.md
Current tokens: designs/tokens-audit.md
```

---

## Step 5 — Generate changes incrementally

Same incremental approach as green field, but anchored to the existing system:

```
# Paper
create_artboard (new screen) or work on existing artboard
write_html (one visual group) → get_screenshot → compare to existing screens → adjust
... repeat per group ...

# Pencil
batch_design: I() or U() — one section at a time
get_screenshot → compare to existing screens → adjust
```

When modifying an existing screen:
1. Screenshot the current state before making changes
2. Generate the modification
3. Screenshot the result
4. Compare side-by-side — confirm the change is scoped and the rest of the screen is unchanged

---

## Step 6 — Round-trip screenshot verification

After generating a component from the design, verify visually before marking the task complete:

```
1. Agent generates component from design node (gen-component)
2. Run dev server: npm run dev (or equivalent)
3. Screenshot the rendered output in the browser
4. Attach screenshot to Claude: "Does this match the design? List any deviations."
5. Claude identifies issues (spacing, color, clipping, missing states)
6. Agent generates targeted fix
7. Repeat until visual output matches design intent
```

This loop closes the gap that code-only generation leaves open: the agent verifies its own visual output rather than relying on structural reasoning alone.

---

## Step 7 — Branch, build, validate, ship

Every UI change follows the standard flow:
```
/new-feature   → sync main, create branch
/build         → agents implement using component map + design nodes
/validate      → QA + visual agents verify output
/ship          → PR, human review, merge
```

Never commit UI changes directly to `main`.

---

## Common failure modes

| Failure | Cause | Fix |
|---|---|---|
| Agent generates duplicate components | No component map | Create `src/components/README.md` before starting |
| New screen looks visually inconsistent | Token audit skipped | Run audit, record in `designs/tokens-audit.md`, feed to agent |
| Change bleeds into unrelated screens | Scope not stated | Explicit scope block at session start |
| Generated code uses wrong tokens | Agent didn't read token file | Add `designs/tokens-audit.md` to agent context explicitly |
| Visual output doesn't match design | No screenshot verification | Run round-trip screenshot loop (Step 6) |

---

## Reference

- [Phase 2 — Design (green field)](phase2-design.md)
- [Phase 4 — Build](phase4-build.md)
- [Iteration & Re-entry](iteration.md)

# Phase 2 — Design

**Tool: Paper (paper.design) or Pencil (pencil.dev) via Claude Code MCP**

This phase converts the spec into visual UI mockups that serve as the source of truth for all frontend development.

---

## Optional: draft with Stitch first

Before opening Paper or Pencil, you can use Google Stitch (AI design tool) to generate rough HTML drafts from `SPEC.md` in seconds. These drafts become visual reference images for `/design-screens`.

```
/design-draft              # generates designs/drafts/*.html + *.png from SPEC.md
/design-screens designs/drafts/landing.png designs/drafts/dashboard.png ...
```

Stitch drafts are **mood and layout references** — `/design-screens` adapts their style into proper Paper or Pencil artboards with real design tokens. They are not the final source of truth.

Requires [Stitch MCP](https://github.com/Kargatharaakash/stitch-mcp) configured in Claude Code. Run `/design-draft` without Stitch installed for setup instructions.

---

## Tool selection

| Scenario | Use |
|---|---|
| Solo/small team, already in VS Code/Cursor | **Pencil.dev** — embedded in IDE, Git-native `.pen` format |
| Want Tailwind JSX output directly from canvas | **Paper.design** — canvas is HTML+CSS, `get_jsx` returns usable code |
| Need to import existing Figma designs | **Pencil.dev** — paste Figma frames, layers and auto-layout preserved |
| Rapid prototyping / "vibe coding" speed | **Paper.design** — fastest idea-to-screen loop |

Set your active tool once per project:
```
/set-design-tool paper    # or: /set-design-tool pencil
```

The choice is stored in `designs/.design-tool` and read by all design skills.

---

## Prerequisites: design brief

Before generating any screens, define the full token set. Visual drift compounds — establish these values once and apply them consistently across every artboard.

```
Background:  #hex     Surface:  #hex     Text:  #hex
Accent:      #hex     Font:     [family] Spacing scale: [rhythm]
```

**How to get there:**
1. Call `get_style_guide_tags` — returns all available style categories
2. Pick 5–10 tags matching your product type, platform, and mood
3. Call `get_style_guide(tags)` — returns a curated color + typography brief
4. Record the brief in `designs/brief.md` — agents read this before generating screens

---

## Green field workflow

### Paper

```
get_basic_info        → check canvas state
get_guide(topic)      → load platform rules (web-app, mobile-app, landing-page)
create_artboard       → one per screen, in user-flow order
write_html (header)   → get_screenshot → adjust
write_html (content)  → get_screenshot → adjust
... repeat per visual group ...
finish_working_on_nodes → done
```

### Pencil

```
get_editor_state      → confirm active .pen file
get_guidelines(topic) → load platform rules
batch_design: I()     → insert frame per screen, in user-flow order
batch_design: I()     → add component groups incrementally
get_screenshot        → visually verify after every 2–3 screens
set_variables         → record design tokens (colors, spacing, typography)
```

---

## Key patterns

**Build in user-flow order.** Design screens in the order a user experiences them: Landing → Sign In → Onboarding → Dashboard → Detail → Settings. Navigation patterns and component reuse are discovered early, before they can drift.

**One visual group per call.** Never generate a full screen in one MCP call. Build nav, hero, card grid, footer as separate operations. Each call is a checkpoint you can verify and correct.

**Screenshot every 2–3 screens.** Call `get_screenshot` after every 2–3 artboards. Check: spacing inconsistencies, clipped elements, typography hierarchy, color contrast. Fix before continuing — visual errors compound.

**Design tokens are code.** Define tokens (colors, spacing, type scale) once in the design file and never hardcode values in generated components. Both tools expose tokens via MCP so the Build phase agent can read them directly.

**Design files live in Git.** Commit `designs/app.paper` or `designs/app.pen` to the repo. Design changes are commits; branches hold design variants; PRs include design diffs alongside code diffs.

---

## Tool reference

### Paper tools

| Tool | Purpose |
|---|---|
| `mcp__paper__get_basic_info` | Canvas metadata, artboards, fonts |
| `mcp__paper__get_guide` | Platform design guidelines (web-app, mobile-app, landing-page) |
| `mcp__paper__create_artboard` | New screen (desktop 1440×900, mobile 390×844) |
| `mcp__paper__write_html` | Add a visual group to an artboard |
| `mcp__paper__get_screenshot` | Visually verify any node or artboard |
| `mcp__paper__update_styles` | Adjust styles on existing nodes |
| `mcp__paper__get_computed_styles` | Read design tokens (colors, spacing, typography) |
| `mcp__paper__get_jsx` | Export artboard as Tailwind JSX — direct input for gen-component |
| `mcp__paper__duplicate_nodes` | Clone artboards or components for variants |
| `mcp__paper__finish_working_on_nodes` | Release working indicator when done |

### Pencil tools

| Tool | Purpose |
|---|---|
| `mcp__pencil__get_editor_state` | Active file, current selection, editor context |
| `mcp__pencil__get_guidelines` | Platform design guidelines (web-app, mobile-app, landing-page) |
| `mcp__pencil__get_style_guide_tags` | Available style tags for brief generation |
| `mcp__pencil__get_style_guide` | Curated color + typography brief from tags |
| `mcp__pencil__batch_design` | Insert, update, copy, replace, delete nodes |
| `mcp__pencil__batch_get` | Read node tree, inspect component structure |
| `mcp__pencil__get_screenshot` | Visually verify any node |
| `mcp__pencil__get_variables` / `set_variables` | Read and write design tokens |
| `mcp__pencil__snapshot_layout` | Detect overlapping or clipped elements |
| `mcp__pencil__find_empty_space_on_canvas` | Suggest position for new frames |
| `mcp__pencil__export_nodes` | Export as PNG, JPEG, WEBP, or PDF |

---

## Motion design annotations

Add text annotations alongside static layouts describing motion intent. These become direct input for `/gen-animation` in Phase 4.

| Annotation | What to specify |
|---|---|
| **Entrance** | How the element appears (fade, slide, scale) + direction + duration |
| **Exit** | How the element leaves (fade, slide) + duration |
| **Scroll trigger** | At what scroll position the animation starts (`top 80%`, `center center`) |
| **Hover state** | Scale, color, or transform change on hover |
| **Page transition** | In/out behavior for full-page route changes |
| **Easing** | Reference the easing table in `frontend/CLAUDE.md` (e.g. `power2.out`) |

---

## Deliverable

`designs/app.paper` or `designs/app.pen` — all required screens with motion annotations, approved by the human.

## Handoff to Phase 3

`frontend/CLAUDE.md` is updated to reference the design file. From this point forward, every frontend agent opens the design and reads the relevant node before coding any UI.

## Intra-phase iteration

```
create_artboard / batch_design → write per visual group → get_screenshot → human feedback → adjust → repeat
```

---

> For modifying an existing application, see [Design — Brownfield](design-brownfield.md).

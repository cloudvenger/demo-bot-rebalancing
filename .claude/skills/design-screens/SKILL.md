---
description: Design all project screens in Paper or Pencil from SPEC.md + PLAN.md + optional reference images
argument-hint: "[path/to/reference.png ...] [--tool=paper|pencil]"
disable-model-invocation: true
---

# /design-screens — Generate Screens from Spec, Plan, and References

Design all screens for the project using the active design tool (Paper or Pencil MCP), guided by SPEC.md, PLAN.md, and optional reference images.

---

## Step 0 — Select design tool

Read `designs/.design-tool`:
- `pencil` → use **Pencil MCP** (`mcp__pencil__*` tools), file extension `.pen`
- `paper` or file missing → use **Paper MCP** (`mcp__paper__*` tools, default), file extension `.paper`
- `--tool=paper` or `--tool=pencil` in `$ARGUMENTS` overrides the config for this run

See `/set-design-tool` for the complete tool equivalence table. The steps below use Paper MCP names — swap them for Pencil equivalents when using Pencil:

| Paper | Pencil |
|---|---|
| `get_basic_info` | `get_editor_state` |
| `create_artboard(name, styles)` | `batch_design` with `I("document", {type:"frame", name, width, height})` |
| `write_html(html, targetId, mode)` | `batch_design` with `I()`, `U()`, `R()` operations |
| `get_screenshot(nodeId)` | `get_screenshot(filePath, nodeId)` |
| `get_style_guide_tags` | `get_style_guide_tags` |
| `get_style_guide(tags)` | `get_style_guide(tags)` |
| `get_guide(topic)` | `get_guidelines(topic)` |
| `get_font_family_info` | `get_font_family_info` |
| `finish_working_on_nodes` | *(omit — no Pencil equivalent)* |

---

## Step 1 — Verify context

- Current branch must not be `main` — if it is, stop and run `/new-feature` first
- `SPEC.md` must exist — if not, stop: "Run `/ideate` first to produce SPEC.md"
- `PLAN.md` should exist — if missing, warn and continue: "PLAN.md not found — screen list will be inferred from SPEC.md only. Run `/plan` after design for a complete component breakdown."

---

## Step 2 — Check the active Paper file

Call `mcp__paper__get_basic_info` to see what is currently open in Paper.

- If a `.paper` file is already open: use it. Note the filename and any existing artboards.
- If nothing is open: inform the user — "No Paper file is open. Create or open a `designs/[project-name].paper` file in Paper first, then re-run `/design-screens`."
- If artboards already exist: list them. Ask the user: "These screens already exist: [list]. Add missing screens only, or redesign all from scratch?"

---

## Step 3 — Read spec and plan

Read `SPEC.md` and extract:
- Product purpose and target user
- Key user flows (onboarding, main action, settings, etc.)
- Explicit list of screens/pages if present (names + purpose)
- UI constraints: mobile-first, desktop, dark mode, brand colors, accessibility requirements

Read `PLAN.md` (if present) and extract:
- Full screen list with component hierarchy per screen
- Data displayed on each screen
- Any design tokens or system constraints already defined

If neither file has an explicit screen list, **infer screens from user flows** — every distinct step a user takes is a screen.

---

## Step 4 — Analyze reference images (if provided)

If `$ARGUMENTS` contains one or more file paths to images (PNG, JPG, PDF, etc.):

- Use the `Read` tool on each path — Claude is multimodal and will ingest the image
- For each image, extract:
  - Layout pattern (full-bleed hero, sidebar + content, card grid, single-column, dashboard, etc.)
  - Color mood (light/dark, warm/cool, neutral/saturated, monochrome)
  - Typography personality (geometric sans, humanist, editorial serif, technical mono, etc.)
  - UI density (spacious marketing vs. compact productivity)
  - Specific component patterns worth replicating (navigation style, card anatomy, button shapes, etc.)

Reference images inform mood and layout — do not clone them pixel-for-pixel. Adapt the style to the product's own identity.

---

## Step 5 — Establish design brief

1. Call `mcp__paper__get_style_guide_tags` to get all available tags
2. Select 5–10 tags matching: product type + extracted image mood + target platform (mobile/website/webapp)
3. Call `mcp__paper__get_style_guide` with those tags to receive a curated style guide
4. Also call `mcp__paper__get_guidelines` with the appropriate topic:
   - `mobile-app` if SPEC targets mobile
   - `web-app` if SPEC targets a SaaS or dashboard product
   - `landing-page` if SPEC targets a marketing or promotional site
5. Call `mcp__paper__get_font_family_info` to verify font availability **before** committing to any font

Write a short design brief and output it to the user:
```
Design brief:
  Visual direction: [one sentence]
  Background: [hex]   Surface: [hex]   Text: [hex]
  Accent: [hex]       Muted: [hex]     Border: [hex]
  Font: [family] — Display [weight], Body [weight]
  Spacing rhythm: section [Xpx] / group [Xpx] / element [Xpx]
  Artboard size: [390×844 mobile / 1440×900 desktop / both]
```

---

## Step 6 — Design each screen

Work through screens in user-flow order (e.g., Landing → Sign In → Onboarding → Dashboard → Detail → Settings).

For each screen:

### a. Create the artboard

```
mcp__paper__create_artboard
  name: "[Screen Name]"   e.g. "Home", "Sign In", "Dashboard"
  width:  390px (mobile) or 1440px (desktop)
  height: 844px (mobile) or 900px (desktop)
```

### b. Build content — ONE visual group per `write_html` call

**Build order:**
1. Artboard shell (background color, padding)
2. Navigation / header bar
3. Hero or primary content area
4. Secondary sections (cards, lists, forms, stats)
5. Footer / action bar / bottom nav

**Rules for every `write_html` call:**
- Use inline styles only (`style="..."`)
- `display: flex` as primary layout — never `display: grid` or `display: inline`
- Use `px` for font sizes; `em` for letter spacing; `px` for line height
- Apply design brief tokens consistently across all screens
- Use realistic placeholder content — no "Lorem ipsum" for headings or labels
- No emoji as icons — use SVG or omit icons entirely

### c. Mandatory review checkpoint — after every 2–3 screens

Call `mcp__paper__get_screenshot` on the most recent artboard.

Evaluate every item:
- **Spacing**: uneven gaps, cramped groups, or unintentionally empty areas?
- **Typography**: readable at size? clear heading/body/caption hierarchy?
- **Contrast**: text readable against background? elements distinguishable?
- **Alignment**: shared vertical lanes across repeated rows?
- **Clipping**: any content cut off at container or artboard edges?

Fix issues before continuing to the next screen.

---

## Step 7 — Cross-screen consistency pass

After all screens are complete:

1. Screenshot each artboard in sequence
2. Check: same nav pattern, same button style, same color usage, same type scale
3. Fix any inconsistencies found

---

## Step 8 — Finish

Call `mcp__paper__finish_working_on_nodes` with no arguments to release all working indicators.

---

## Step 9 — Report

```
=== Screens designed ===

  [Screen name]   [dimensions]   ✓
  ...

  Design file:  designs/[project-name].paper
  Brief:        [one-sentence direction]
  Font:         [family]
  Accent:       [hex]
  Screens:      [N] total

Next steps:
  1. Review screens in Paper — adjust any details manually
  2. Run /gen-component [ScreenName] to generate code for each screen
  3. Run /plan if PLAN.md is not yet complete
```

---

## Rules

- Always write incrementally — ONE visual group per `write_html` call. Never batch an entire screen.
- Mandatory screenshot review every 2–3 artboards — non-negotiable.
- Verify fonts with `get_font_family_info` before using any new font family.
- Reference images are mood/layout references — do not copy them literally.
- Use `mcp__paper__get_guidelines` for platform-specific layout rules.
- If artboards already exist for a screen, skip it unless the user explicitly asked to redesign.
- Do NOT start designing without a design brief — Steps 4–5 are required.

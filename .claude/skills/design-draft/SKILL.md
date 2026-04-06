---
description: Generate AI draft screens with Google Stitch from SPEC.md and/or wireframe SVGs — produces HTML + screenshots to use as reference for /design-screens
argument-hint: "[path/to/wireframes/] [--screens=all|<name,name,...>]"
disable-model-invocation: true
---

# /design-draft — Generate Draft Screens with Google Stitch

Uses Google Stitch (AI design tool) to generate polished draft screens from `SPEC.md` and/or existing wireframe SVGs. Outputs HTML files and screenshots into `designs/drafts/` — these become reference images for `/design-screens`, giving Paper or Pencil a visual head start.

**This is an optional Phase 2 accelerator.** Skip it if you prefer to design from scratch in Paper or Pencil.

**Two input modes:**
- **From SPEC.md only** — infers screens from user flows and generates from scratch
- **From wireframe SVGs** — reads existing wireframes, extracts layout/structure/labels, and generates higher-fidelity drafts that match the wireframe intent

Both modes can combine: wireframes provide structure, SPEC.md provides context and fills gaps for screens that have no wireframe yet.

---

## Step 0 — Check prerequisites

**SPEC.md:**
- Must exist. If not: "Run `/ideate` first to produce SPEC.md."

**Stitch MCP:**
- Check whether `mcp__stitch__*` tools are available (try calling any Stitch tool).
- If Stitch is not configured, print the setup instructions below and stop.

### Stitch MCP setup instructions (if not configured)

Two options — recommend Option A for simplicity:

**Option A — API key (simpler)**
```bash
# 1. Get your API key at https://stitch.withgoogle.com → Settings
# 2. Add to your Claude Code MCP config:
```
```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["-y", "stitch-mcp"],
      "env": { "STITCH_API_KEY": "your-api-key-here" }
    }
  }
}
```
*(community server: [github.com/Kargatharaakash/stitch-mcp](https://github.com/Kargatharaakash/stitch-mcp))*

**Option B — gcloud OAuth (official)**
```bash
npx @_davideast/stitch-mcp init   # one-time OAuth setup
```
```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["@_davideast/stitch-mcp", "proxy"]
    }
  }
}
```
*(official server: [github.com/davideast/stitch-mcp](https://github.com/davideast/stitch-mcp))*

After adding the config, restart Claude Code and re-run `/design-draft`.

---

## Step 1 — Detect wireframe input

Check `$ARGUMENTS` for a directory path or glob pattern pointing to wireframe SVGs.

**If a wireframe path is provided** (e.g., `docs/delivery/wireframes/`):

1. Glob for `*.svg` files recursively under the given path
2. Group files by journey/directory (e.g., `journey-a-welcome-onboarding/`, `journey-b-create-a-vault/`)
3. For each SVG, extract the screen name from the filename convention `[CODE]-[screen-name].svg` (e.g., `A2-sign-in.svg` → "Sign In", `B3-add-owners.svg` → "Add Owners")
4. Skip files named `*flow-map*` — these are journey diagrams, not screens
5. Build a wireframe manifest:
   ```
   Wireframe manifest:
     Journey A — Welcome & Onboarding:
       A1-welcome-splash.svg  → "Welcome Splash"   390×844
       A2-sign-in.svg         → "Sign In"           390×844
       ...
     Journey B — Create a Vault:
       B2-vault-info.svg      → "Vault Info"         390×844
       ...
   ```
6. Report the manifest to the user before proceeding

**If no wireframe path is provided:** skip to Step 2 (SPEC.md-only mode).

---

## Step 2 — Read SPEC.md

Extract:
- Product name and one-sentence description
- Target platform: mobile, desktop, or both
- Key user flows (onboarding, main action, settings, etc.)
- Explicit screen list if present — otherwise infer one screen per flow step
- Brand constraints: colors, tone, any explicit style direction

Build a final screen list by merging:
1. Screens from wireframes (Step 1) — these are the primary source when wireframes exist
2. Screens from SPEC.md — fills gaps for screens that have no wireframe

If `$ARGUMENTS` contains `--screens=<name,name,...>`, limit drafts to those screens only.

---

## Step 3 — Analyze wireframes (when provided)

For each wireframe SVG in the manifest:

### a. Read the SVG visually

Use the `Read` tool on the SVG file — Claude is multimodal and will render the SVG. Extract:
- **Layout structure**: header/nav position, content sections, bottom bar, sheet overlays
- **Component inventory**: buttons, inputs, lists, cards, icons, modals, bottom sheets
- **Text labels and copy**: read all visible text (headings, button labels, placeholder text, descriptions)
- **Spacing and hierarchy**: relative sizes, grouping, visual weight
- **Interaction hints**: toggle states, selection indicators, disabled elements, flow arrows

### b. Read the SVG source for semantic details

Also read the raw SVG source (first ~100 lines) to extract:
- XML comments describing sections (e.g., `<!-- Status bar -->`, `<!-- Bottom sheet panel -->`)
- Named groups and IDs that reveal intent
- Dimensions (`width`, `height`, `viewBox`) to confirm screen size

### c. Build a structured screen description

Combine visual and source analysis into a screen description:
```
Screen: Sign In (A2)
  Platform: mobile (390×844)
  Layout: dimmed background (previous screen behind) + bottom sheet overlay
  Components:
    - Status bar (top)
    - Dimmed background with "[Welcome screen behind]" hint
    - Bottom sheet (white, rounded top corners, drag handle)
    - App icon (44×44, dark) + close button (top-right)
    - "Sign in" heading
    - "Connect your World ID" subheading
    - World ID button (primary CTA)
    - "Other sign-in options" link
    - Terms of service footer text
  Copy: "Sign in", "Connect your World ID to access worldSafe", "Continue with World ID"
```

---

## Step 4 — Prepare output directory

Create `designs/drafts/` if it does not exist.

---

## Step 5 — Generate drafts with Stitch

For each screen in the final list:

### a. Build a screen prompt

Write a concise, specific prompt for this screen. Include:
- Screen name and purpose
- Platform (mobile 390px / desktop 1440px)
- Key UI elements visible on this screen (nav, hero, form, list, etc.)
- Brand/tone from SPEC.md

**When a wireframe exists for this screen**, enrich the prompt with the structured description from Step 3:
- Describe the exact layout (e.g., "bottom sheet overlay on dimmed background")
- List every component in order from top to bottom
- Include all text labels and copy verbatim
- Specify interaction states visible in the wireframe
- Add: "Follow this wireframe layout precisely. Upgrade from wireframe to polished UI with proper colors, typography, and spacing."

**When no wireframe exists**, generate from SPEC.md context alone (original behavior).

Example prompt for a wireframed "Sign In" screen:
> "Mobile sign-in screen (390×844). Dimmed background showing previous welcome screen behind. White bottom sheet overlay with rounded top corners and drag handle. Inside the sheet: app icon (top-left) and close button (top-right), 'Sign in' heading, 'Connect your World ID to access worldSafe' subheading, large primary 'Continue with World ID' button with World ID icon, 'Other sign-in options' text link below, and terms of service footer at the bottom. Clean, modern, dark brand accent on white. Follow this wireframe layout precisely."

### b. Call Stitch to generate the design

Use the available Stitch MCP tool to generate or retrieve the screen design. Depending on which server is configured:

- **Generation tool available** (community server): call the generate/design tool with the prompt
- **`build_site` / `get_screen_code`** (official server): if a Stitch project is already open, retrieve the screen HTML via `mcp__stitch__get_screen_code`
- **`get_screen_image`**: always call this to get the screenshot as base64

### c. Save outputs

For each screen, save:
1. `designs/drafts/[screen-name].html` — raw HTML from Stitch
2. `designs/drafts/[screen-name].png` — screenshot (decode base64, write file)

Name files in kebab-case matching the wireframe name when available: `a2-sign-in.html`, `a2-sign-in.png`.

---

## Step 6 — Report

Print a summary and the ready-to-use `/design-screens` command:

```
=== Stitch drafts generated ===

  Source: [wireframes (N files) + SPEC.md | SPEC.md only]

  Journey A — Welcome & Onboarding:
    A1 Welcome Splash   designs/drafts/a1-welcome-splash.html + .png   ✓  (from wireframe)
    A2 Sign In           designs/drafts/a2-sign-in.html + .png          ✓  (from wireframe)
    ...

  Journey B — Create a Vault:
    B2 Vault Info        designs/drafts/b2-vault-info.html + .png       ✓  (from wireframe)
    ...

  No wireframe (from SPEC.md):
    Settings             designs/drafts/settings.html + .png            ✓  (from spec)

  [N] screens drafted in designs/drafts/

Next step — use drafts as visual reference for the design canvas:

  /design-screens designs/drafts/a1-welcome-splash.png designs/drafts/a2-sign-in.png ...

  /design-screens will:
    1. Analyze the draft screenshots for layout, color mood, and component patterns
    2. Build polished Paper/Pencil artboards using those as visual input
    3. Produce the final design source of truth (*.paper or *.pen)

Note: drafts are rough AI output — /design-screens refines their style, it does not
copy them pixel-for-pixel. Wireframe-sourced drafts will be closer to the final layout
than spec-only drafts.
```

---

## Rules

- Never overwrite an existing `designs/drafts/` file without warning — list existing files first and ask.
- Save only HTML and PNG — do not write Stitch API keys or tokens to any file.
- Drafts are inputs for `/design-screens`, not the final design — do not commit them as source of truth.
- If Stitch generation fails for a screen, skip it, log the error, and continue with the remaining screens.
- Do not add Stitch MCP config to `.claude/settings.json` — that file is committed to Git and must not contain secrets.
- When wireframes are provided, preserve the wireframe's layout intent — Stitch should upgrade visual fidelity, not reinvent the structure.
- Read every wireframe SVG both visually (multimodal) and as source (for comments/IDs) — the combination gives the richest prompt.
- Skip `*flow-map*` SVGs — they are journey diagrams, not screen wireframes.
- Maintain the wireframe filename prefix (e.g., `a2-`, `b3-`) in the output filenames so the source wireframe is always traceable.

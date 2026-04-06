---
description: Audit UX language coherence — component names, labels, text, and wireframes against SPEC.md ubiquitous language
argument-hint: "[--tool=paper|pencil] [--no-wireframes]"
allowed-tools: Read, Glob, Grep, Task, Write, Bash, mcp__paper__get_basic_info, mcp__paper__get_children, mcp__paper__get_screenshot, mcp__pencil__batch_get, mcp__pencil__get_editor_state, mcp__pencil__get_screenshot
---

# /audit-ux-language — UX Language Coherence Audit

Audit all design artifacts (design screens, wireframes, HTML drafts) against the project's ubiquitous language defined in SPEC.md. Flags naming inconsistencies, synonym drift, placeholder text, and cross-artifact incoherence.

This skill is also spawnable by `/validate` **only when UX modifications are detected** in the current diff (see Step 0b).

---

## Step 0a — Select design tool

Read `designs/.design-tool`:
- `pencil` → use **Pencil MCP** (`mcp__pencil__*` tools), file extension `.pen`
- `paper` or file missing → use **Paper MCP** (`mcp__paper__*` tools, default), file extension `.paper`
- `--tool=paper` or `--tool=pencil` in `$ARGUMENTS` overrides the config for this run

---

## Step 0b — Spawn gate (for /validate integration only)

> **This step is ONLY executed when this skill is spawned by `/validate` as a subagent.**
> When run directly via `/audit-ux-language`, skip to Step 1.

Before doing any audit work, check whether UX modifications are present in the current branch:

```bash
git diff main --name-only | grep -E "designs/|\.paper$|\.pen$|\.html$|wireframe|mockup|draft"
```

- If **no design files were modified** → exit immediately with:
  ```
  [audit-ux-language] No UX changes detected — skipping language audit.
  ```
- If **design files were modified** → continue to Step 1 and run the full audit.

---

## Step 1 — Extract the ubiquitous language from SPEC.md

Read `SPEC.md`. If it does not exist, stop: "No SPEC.md found — run `/ideate` first."

Extract and build a **domain glossary**:
- **Entities**: nouns naming core domain objects (`Order`, `Customer`, `Invoice`, `Workspace`)
- **Actions**: verbs for user interactions (`Submit`, `Approve`, `Archive`, `Publish`)
- **Roles**: user types (`Admin`, `Viewer`, `Owner`, `Guest`)
- **Features/Modules**: named product areas (`Dashboard`, `Billing`, `Notifications`)
- **States**: domain states (`Pending`, `Active`, `Expired`, `Draft`)

Output the glossary to the user:
```
=== Domain Glossary (from SPEC.md) ===
  Entities:  [list]
  Actions:   [list]
  Roles:     [list]
  Features:  [list]
  States:    [list]
```

Also detect potential **synonym clusters** — words that may refer to the same concept across artifacts (e.g., `Client/Customer`, `Order/Purchase/Transaction`). Flag these proactively.

---

## Step 2 — Detect all design artifacts

Scan the repo for every design artifact to audit.

### a. Design files (Paper / Pencil)

Look for:
- `designs/*.paper` (Paper files)
- `designs/*.pen` (Pencil files)

Use MCP to read nodes:
- **Paper**: `mcp__paper__get_children` on each artboard — collect all node `name` and text `content` values
- **Pencil**: `mcp__pencil__batch_get` with `patterns: [{type:"text"}]` and `patterns: [{reusable:true}]`

Collect:
- All layer/component names (node `name` property)
- All text node content
- All artboard/screen names

### b. Wireframes (if present)

Skip this section if `--no-wireframes` is in `$ARGUMENTS`.

Scan in this order:
1. `designs/drafts/*.html` — Google Stitch HTML drafts from `/design-draft`
2. `designs/drafts/*.png`, `designs/drafts/*.jpg` — screenshot exports
3. `designs/wireframes/` — any dedicated wireframe folder
4. `designs/*.png`, `designs/*.jpg`, `designs/*.pdf` — loose image files in `designs/`
5. Any file matching `*wireframe*`, `*mockup*`, `*draft*` anywhere in the repo (use Glob)

**For HTML wireframes** — use `Read` to load, extract:
- All visible text (headings, labels, buttons, nav items, link text)
- `id` and `class` values using PascalCase, camelCase, or kebab-case (likely component names)
- `aria-label`, `placeholder`, `alt`, `title` attributes

**For image wireframes** — use `Read` (multimodal vision) on each image, extract:
- All visible text labels, headings, button text, nav items
- Annotation text overlaid on the wireframe
- Component/section labels if present

If no wireframes are found, note "No wireframes detected" and continue with design files only.

---

## Step 3 — Run the coherence audit

Spawn a **general-purpose** agent with this prompt:

```
You are a UX language auditor. Check coherence between the project's ubiquitous language and all design artifacts below.

## Domain Glossary
[Insert glossary extracted in Step 1]

## Synonym clusters (potential drift candidates)
[Insert synonym clusters]

## Design file artifacts
[Insert all node names and text content from Step 2a]

## Wireframe artifacts
[Insert all text/labels extracted from Step 2b, or "none"]

---

## Checks to perform

### Check 1 — Generic component names [ERROR]
Flag any layer/component name that is generic and not domain-meaningful:
- Exact: Frame, Group, Container, Card, Button, Text, Image, Icon, Section, Row, Column,
  Item, List, Header, Footer, Wrapper, Box, Panel, Block, Page, Screen, View, Layer
- Numbered variants: Frame1, Card2, Button_3, Group 4
- These must be renamed to domain terms from the glossary.

### Check 2 — Synonym drift [WARNING]
Detect the same concept expressed with different words across artifacts:
- Compare all names and text against synonym clusters.
- Flag: "Screen A uses 'Customer', Screen B uses 'Client' — pick one and align."
- Flag: "SPEC says 'Archive' but design button says 'Delete' — verify intent."

### Check 3 — Vocabulary mismatches [WARNING]
Find terms in design artifacts NOT in the domain glossary and not in SPEC.md:
- May be invented terms, placeholder content, or jargon not aligned with the spec.
- Flag: "Term '[X]' appears in [artifact] but is not in SPEC.md."

### Check 4 — Placeholder leakage [ERROR]
Flag any of these in text content:
- "Lorem ipsum", "lorem", "ipsum", "placeholder", "TODO", "FIXME", "test", "dummy",
  "sample", "foo", "bar", "baz", "[insert", "TBD", "...", "untitled", "copy here"

### Check 5 — Action verb consistency [WARNING]
CTAs and action labels must be consistent across all screens and wireframes:
- Flag: Same action with different verbs ("Save" vs "Submit" vs "Confirm" for the same operation).
- Flag: Passive vs active mismatch ("Delete account" vs "Account deletion").

### Check 6 — Screen/artboard naming [ERROR]
Screen names must match the feature/page names in SPEC.md:
- Flag screens not mentioned in SPEC.
- Flag SPEC screens missing from the design file.
- Flag names using different vocabulary than SPEC (e.g., SPEC says "Billing", artboard says "Payment Settings").

### Check 7 — Wireframe vs design coherence [WARNING]
(Only if wireframes are present)
Compare wireframe labels against design file labels:
- Flag labels present in wireframes but renamed or missing in the design without justification.
- Flag flows present in wireframes but missing screens in the design file.
- Flag text content that diverged significantly between wireframe and design stages.

### Check 8 — Role/persona naming [INFO]
Ensure user roles are consistently named across all artifacts:
- Flag: "Admin" in SPEC but "Administrator" in design, "User" vs "Member", etc.

---

## Output format

Produce a structured plain-text report:

```
=== UX Language Audit Report ===

ERRORS (must fix before shipping):
  [E1] Generic name: Layer "Card" in "Dashboard" artboard → rename to domain term (e.g., "OrderSummaryCard")
  [E2] Placeholder: "Lorem ipsum" found in "Profile" screen → replace with real copy
  ...

WARNINGS (should fix):
  [W1] Synonym drift: "Customer" (SPEC.md, Checkout screen) vs "Client" (Invoice screen) — align to one term
  [W2] Wireframe vs design: "Save Draft" in wireframe → "Save" in design — verify intent matches
  ...

INFO:
  [I1] Role naming: "Admin" (SPEC) vs "Administrator" (Settings screen) — minor inconsistency
  ...

SUMMARY:
  Errors:    N
  Warnings:  N
  Info:      N
  Artifacts audited: [list design files and wireframes]
  Glossary size: N terms
```

Return the full structured report as text.
```

---

## Step 4 — Write the audit report

Write `designs/ux-language-audit.md`:

```markdown
# UX Language Audit

**Date**: [today]
**Branch**: [current git branch]
**Design file**: [filename]
**Wireframes audited**: [list of files, or "none found"]
**Spec**: SPEC.md

## Domain Glossary

| Category | Terms |
|---|---|
| Entities | [list] |
| Actions | [list] |
| Roles | [list] |
| Features | [list] |
| States | [list] |

## Findings

### Errors
[E items — numbered]

### Warnings
[W items — numbered]

### Info
[I items — numbered]

## Summary

| Severity | Count |
|---|---|
| Errors | N |
| Warnings | N |
| Info | N |
```

---

## Step 5 — Sign off

```
=== /audit-ux-language complete ===

  Design file:  designs/[name].[ext]
  Wireframes:   [N files audited, or "none"]
  Glossary:     [N domain terms extracted]

  Errors:    N   ← must fix before shipping
  Warnings:  N   ← should fix before /gen-component
  Info:      N

  Report: designs/ux-language-audit.md

Next steps:
  • Fix all ERRORs — rename generic layers, remove placeholders, align screen names with SPEC
  • Review WARNINGs — resolve synonym drift before running /gen-component (it will propagate names into code)
  • Re-run /audit-ux-language after fixes to confirm clean
  • Link the audit report in your PR description
```

---

## Rules

- Always extract the glossary from SPEC.md first — never invent or assume domain terms.
- Wireframe scan is automatic unless `--no-wireframes` is passed or no wireframes are found.
- This skill is **read-only** — it reports issues, never auto-fixes design files.
- Errors block shipping — treat them like failing tests.
- When spawned by `/validate`, only run if UX files changed (Step 0b gate).
- After fixing issues in the design tool, re-run `/audit-ux-language` to confirm clean.

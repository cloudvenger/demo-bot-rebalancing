---
description: Generate a UI component from a design node (Paper or Pencil)
argument-hint: "[ComponentName] [--tool=paper|pencil]"
---

Generate a UI component from the active design tool.

Steps:
0. **Select design tool** — read `designs/.design-tool` (`paper` default, `pencil` if set, or `--tool=` argument overrides). Adjust all tool references below accordingly:
   - Paper: `get_basic_info` / `get_tree_summary` / `get_jsx` / `get_computed_styles` / `get_screenshot`
   - Pencil: `get_editor_state` / `batch_get(readDepth)` / *(no get_jsx — read raw node structure via batch_get)* / `search_all_unique_properties` / `get_screenshot(filePath, nodeId)`
   - **Note:** Paper's `get_jsx` produces cleaner component output. If Pencil is active, interpret the raw node structure from `batch_get` to reconstruct layout and styles manually.
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Ask the user: which screen or component node in the design should be implemented?
   (or use the node name/ID provided in the arguments)
3. Use `mcp__paper__get_basic_info` (or `get_editor_state`) to understand the canvas structure, then `mcp__paper__get_tree_summary` (or `batch_get`) to explore the target artboard's hierarchy
4. Use `mcp__paper__get_screenshot` (or `get_screenshot(filePath, nodeId)`) to visually inspect the design node
5. Use `mcp__paper__get_jsx` to export the JSX structure — **Paper only**. If using Pencil: use `batch_get` with `readDepth: 5` to read the full node tree, then reconstruct the layout from node types, positions, and styles
6. Use `mcp__paper__get_computed_styles` (or `search_all_unique_properties`) on key nodes to extract exact design tokens (colors, spacing, typography)
7. Read `frontend/CLAUDE.md` to understand the stack and component conventions
8. Check if the component already exists — if so, confirm with the user before overwriting
9. Generate the component file:
   - Match the design exactly: layout, spacing, colors, typography
   - Apply design tokens extracted from the Paper design
   - Handle loading, error, and empty states
   - Add accessibility attributes
   - Place the file in the correct directory following project conventions
10. Generate a test file alongside the component
11. Run `/check` — fix any failures before proceeding
12. Report: component file path, test file path, any design decisions made

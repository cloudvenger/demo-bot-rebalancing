---
description: Set the active design tool for all design skills — choose between Paper (paper.design) and Pencil (pencil.dev)
argument-hint: "[paper|pencil]"
disable-model-invocation: true
---

# /set-design-tool — Choose Your Design Tool

Sets which MCP design tool all design skills will use. The choice is stored in `designs/.design-tool` and read automatically by every design skill in this project.

```
/set-design-tool paper    ← use Paper MCP (paper.design)
/set-design-tool pencil   ← use Pencil MCP (pencil.dev)
```

---

## Step 1 — Validate argument

If `$ARGUMENTS` is empty or not `paper`/`pencil`, ask:
> "Which design tool do you want to use? [paper] for paper.design, [pencil] for pencil.dev"

---

## Step 2 — Write config

Create or overwrite `designs/.design-tool` with the chosen value (`paper` or `pencil`), then confirm:

```
Design tool set to: [paper|pencil]

All design commands will now use [Paper MCP / Pencil MCP]:
  /design-screens   → designs all screens using [Paper/Pencil] MCP tools
  /gen-component    → reads design nodes via [Paper/Pencil] MCP
  /gen-animation    → reads design nodes via [Paper/Pencil] MCP
  /validate         → Visual Agent compares app vs. [Paper/Pencil] artboards

To switch back: /set-design-tool [paper|pencil]
```

---

## Step 3 — Check MCP availability

- If `paper` selected: check that `mcp__paper__get_basic_info` is available. If not, warn: "Paper MCP tools are not detected. Make sure paper.design is installed and running."
- If `pencil` selected: check that `mcp__pencil__get_editor_state` is available. If not, warn: "Pencil MCP tools are not detected. Make sure pencil.dev is installed and running."

---

## Tool Equivalence Table

This is the reference used by all design skills when selecting tool-specific commands.

| Purpose | Paper MCP | Pencil MCP |
|---|---|---|
| Check active file / list screens | `get_basic_info` | `get_editor_state` |
| Open a specific file | (via Paper app) | `open_document(filePath)` |
| Read node details | `get_node_info(nodeId)` | `batch_get(nodeIds)` |
| Read node tree | `get_tree_summary(nodeId)` | `batch_get(patterns, readDepth)` |
| Screenshot a node | `get_screenshot(nodeId)` | `get_screenshot(filePath, nodeId)` |
| Get JSX structure | `get_jsx(nodeId)` | *(no equivalent — use `batch_get` to read raw node structure)* |
| Get computed styles | `get_computed_styles(nodeIds[])` | `search_all_unique_properties(parents, properties)` |
| Get image fill | `get_fill_image(nodeId)` | *(no equivalent)* |
| Get font info | `get_font_family_info(familyNames)` | `get_font_family_info(familyNames)` |
| Style guide tags | `get_style_guide_tags` | `get_style_guide_tags` |
| Style guide | `get_style_guide(tags)` | `get_style_guide(tags, name)` |
| Design guidelines | `get_guide(topic)` | `get_guidelines(topic)` |
| Create new screen | `create_artboard(name, styles)` | `batch_design` with `I("document", {type:"frame", ...})` |
| Write/insert content | `write_html(html, targetNodeId, mode)` | `batch_design` with `I()`, `U()`, `R()` operations |
| Update styles | `update_styles(updates[])` | `batch_design` with `U(nodeId, {fill, ...})` |
| Set text | `set_text_content(updates[])` | `batch_design` with `U(nodeId, {content: "..."})` |
| Delete node | `delete_nodes(nodeIds[])` | `batch_design` with `D(nodeId)` |
| Duplicate node | `duplicate_nodes(nodes[])` | `batch_design` with `C(nodeId, parent, {})` |
| Finish / release | `finish_working_on_nodes()` | *(no equivalent — omit)* |
| File extension | `.paper` | `.pen` |
| Variable inspection | *(via get_computed_styles)* | `get_variables(filePath)` |
| Layout inspection | *(via get_computed_styles)* | `snapshot_layout(filePath)` |

### Content authoring difference

**Paper** uses HTML/CSS via `write_html` — familiar syntax, incremental per visual group:
```html
<div style="display:flex; flex-direction:column; padding:24px; background:#F5F4F0;">
  <h1 style="font-size:32px; font-weight:700;">Dashboard</h1>
</div>
```

**Pencil** uses an operations DSL via `batch_design` — script-based, node-level:
```javascript
screen=I("document", {type:"frame", name:"Dashboard", width:1440, height:900})
header=I(screen, {type:"frame", layout:"horizontal", padding:24, fill:"#F5F4F0"})
title=I(header, {type:"text", content:"Dashboard", fontSize:32, fontWeight:700})
```

### Key capability gaps

| Feature | Paper | Pencil |
|---|---|---|
| Export JSX for code generation | `get_jsx` ✓ — exports ready-to-use JSX | No equivalent — must interpret raw node structure |
| HTML/CSS authoring | `write_html` ✓ — standard web syntax | Not available — must use ops DSL |
| Image fills | `get_fill_image` ✓ | Not available |
| Layout diagnostics | Not available | `snapshot_layout` ✓ |
| Variable/theme system | Not available | `get_variables` / `set_variables` ✓ |
| AI-generated images | `write_html` with img src | `batch_design` with `G(nodeId, "ai", prompt)` ✓ |

**Recommendation:**
- Use **Paper** when: generating components from designs (`/gen-component`, `/gen-animation`) — `get_jsx` produces cleaner code output
- Use **Pencil** when: design system / variables / theming matter, or you prefer script-based design control
- Both work well for `/design-screens` — the HTML vs ops DSL difference is mostly authoring style

---

## How design skills read this config

Every design skill (`/design-screens`, `/gen-component`, `/gen-animation`, visual agent) starts with:

```
1. Read `designs/.design-tool`
   - `paper` or file missing → use Paper MCP
   - `pencil` → use Pencil MCP
2. If $ARGUMENTS contains --tool=paper or --tool=pencil → override config for this run
3. Continue with appropriate tool commands per the equivalence table above
```

The override argument lets you test one tool without changing the project default:
```
/gen-component Dashboard --tool=pencil   ← one-off pencil run, config unchanged
```

---

## Rules

- `designs/.design-tool` is the single source of truth — all skills read it, none write it except this skill
- If the file is missing, all skills default to `paper`
- Do NOT commit API keys or secrets — the config contains only `paper` or `pencil`
- The config is per-project — different repos can use different tools

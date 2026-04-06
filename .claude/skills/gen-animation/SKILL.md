---
description: Generate a GSAP + Lenis animated component from a design node (Paper or Pencil)
argument-hint: "[ComponentName] [--tool=paper|pencil]"
---

Generate an animated component using GSAP and Lenis based on a design node.

Steps:
0. **Select design tool** — read `designs/.design-tool` (`paper` default, `pencil` if set, or `--tool=` argument overrides). Adjust tool references below:
   - Paper: `get_basic_info` / `get_node_info` / `get_screenshot(nodeId)` / `get_jsx`
   - Pencil: `get_editor_state` / `batch_get(nodeIds)` / `get_screenshot(filePath, nodeId)` / *(no get_jsx — use batch_get with readDepth to read node structure)*
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Ask the user: which component or screen needs animation? (or use the name/ID provided in arguments)
3. Read `frontend/CLAUDE.md` to load the animation conventions, easing table, and setup rules
4. Use `mcp__paper__get_basic_info` (or `get_editor_state`) to find the target artboard, then `mcp__paper__get_node_info` (or `batch_get`) to read the target node and its motion annotations
5. Use `mcp__paper__get_screenshot` (or `get_screenshot(filePath, nodeId)`) to visually inspect the element to be animated
6. Use `mcp__paper__get_jsx` to export the JSX structure — **Paper only**. If using Pencil: use `batch_get` with `readDepth: 5` on the target node, then reconstruct layout and styles from the node tree
7. Identify the animation type from the design annotations:
   - **Entrance**: element appears on mount or scroll — use `gsap.from()` with ScrollTrigger
   - **Exit**: element leaves on unmount or route change — use `gsap.to()` in cleanup
   - **Scroll-driven**: parallax or reveal on scroll — use ScrollTrigger with `scrub`
   - **Hover**: interactive state change — use `gsap.to()` inside event handlers
   - **Page transition**: full-page route in/out — use a GSAP timeline with enter/leave callbacks
8. Generate the component file following these rules:
   - Use `useGSAP()` from `@gsap/react` (never raw `useEffect`)
   - Only animate `transform` and `opacity`
   - Use the easing from `frontend/CLAUDE.md` that matches the animation type
   - Wrap in `prefers-reduced-motion` check — provide a no-motion fallback
   - For scroll animations: set `scrollTrigger.kill()` in the cleanup
   - Lenis is never instantiated here — import from `lib/motion.ts` if scroll position is needed
9. If the component requires Lenis scroll coordination (e.g., scrollTo on page transition):
   - Import `lenis` from `lib/motion.ts`
   - Call `lenis.scrollTo(0, { immediate: true })` before exit animations
10. Place the file in the correct directory following project conventions
11. Run `/check` — fix any failures before proceeding
12. Report: file path, animation type applied, easing used, any design annotations that were unclear

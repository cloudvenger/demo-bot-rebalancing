# Frontend Agent Context

Inherits all rules from root [CLAUDE.md](../CLAUDE.md). Rules below are specific to the frontend layer.

---

## Responsibilities
- UI components and pages
- State management
- API integration (calling backend routes)
- Routing and navigation
- Styling and design token application

---

## Stack (fill in after scaffolding)
- **Framework**: TBD (Next.js / Vite+React / SvelteKit / etc.)
- **Styling**: TBD (Tailwind CSS / CSS Modules / styled-components)
- **State**: TBD (Zustand / Redux / Jotai / Context)
- **Data fetching**: TBD (React Query / SWR / tRPC)
- **Testing**: TBD (Vitest / Jest + React Testing Library / Playwright)
- **Animation**: GSAP + ScrollTrigger plugin
- **Smooth scroll**: Lenis

---

## Architecture Pattern
- **Folder structure**: TBD (Feature-first / Atomic Design)
  - Feature-first: group by domain — `features/auth/`, `features/dashboard/`, `shared/components/`
  - Atomic Design: group by abstraction level — `atoms/`, `molecules/`, `organisms/`, `templates/`
- **Component model**: TBD (Co-located — component + test + styles in same folder / Centralized)
- **Design token usage**: Always use semantic tokens (`--color-primary`) in components, never primitive tokens (`--blue-500`) directly

> Filled in during Phase 3 by `/plan`. Every new component must follow the chosen folder structure — do not mix patterns.

---

## SOLID Principles (adapted for UI)

SOLID applies to frontend code too — translated from classes to components and hooks.

| Principle | Rule in this codebase |
|---|---|
| **S** — Single Responsibility | One component = one visual concern. One custom hook = one piece of state logic. A `useAuth` hook should not also manage cart state. A `UserCard` component should not also fetch user data — delegate that to a hook. |
| **O** — Open/Closed | Extend components via **props and composition**, not by modifying them. Use `children`, render props, or slot patterns to add behavior without touching the component internals. |
| **L** — Liskov Substitution | Component variants (e.g., `PrimaryButton`, `GhostButton`) must be fully interchangeable in any context that accepts a `Button`. Don't add props that only make sense for one variant. |
| **I** — Interface Segregation | Keep prop interfaces minimal. Don't bundle unrelated props into one component. If a component needs 10+ props, split it or use composition. Optional props that are only used in one callsite are a design smell. |
| **D** — Dependency Inversion | Components receive data via **props or context** — they do not call `fetch` or import API modules directly. Data fetching lives in custom hooks; hooks are injected into components, not hardcoded. |

**Practical checklist before any PR:**
- [ ] Does this component do exactly one visual thing?
- [ ] Does this hook manage exactly one concern?
- [ ] Is all data fetching in hooks, not in component bodies?
- [ ] Can this component be extended via props without modifying its internals?

---

## Design Source of Truth
- All UI work starts with opening the Paper design file: `../designs/app.paper`
- Use `mcp__paper__get_basic_info` then `mcp__paper__get_tree_summary` to explore the design hierarchy before coding a component
- Use `mcp__paper__get_screenshot` to visually verify a design node
- Use `mcp__paper__get_jsx` to export the JSX structure of a node as the component starting point
- Use `mcp__paper__get_computed_styles` to extract design tokens (colors, spacing, typography)

## Component Rules
- One component per file
- Component file name = PascalCase (e.g., `UserCard.tsx`)
- No inline styles — use the design system classes or tokens
- All interactive elements must have accessible labels (`aria-label`, `aria-describedby`)
- Every component that fetches data must handle: loading, error, and empty states

---

## State Management Rules
- Server state (API data) → use the chosen data-fetching library (React Query / SWR)
- UI state (modals, toggles) → local `useState`, lift only when necessary
- Global app state → use the chosen state library, only for truly global data

---

## API Integration Rules
- All API calls go through a central `lib/api.ts` (or equivalent) client module
- Never call `fetch` directly in components — always use the API client
- Handle 401 responses globally (redirect to login)

---

## Routing Conventions
- Pages/routes are co-located with their components in a `pages/` or `app/` directory
- Dynamic segments use kebab-case: `/user-profile/[id]`
- Protected routes are wrapped in a shared auth guard component

---

## Animation & Motion

### Setup — initialize once at app root
```ts
// lib/motion.ts
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export const lenis = new Lenis()
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)
```

Import `lib/motion.ts` once at the app entry point. Never instantiate Lenis more than once.

### Easing conventions
| Use case | Easing |
|---|---|
| Entrance (fade in, slide in) | `power2.out` |
| Exit (fade out, slide out) | `power2.in` |
| Page transition | `expo.inOut` |
| Attention / bounce | `elastic.out(1, 0.3)` |
| Scroll-driven (parallax) | `none` |

### Rules
- **Always use `useGSAP()`** from `@gsap/react` in React components — never raw `useEffect` for GSAP
- **Always clean up**: `useGSAP()` handles cleanup automatically; for ScrollTrigger, call `trigger.kill()` on unmount
- **Lenis is global** — never instantiate it inside a component; import from `lib/motion.ts`
- **Respect `prefers-reduced-motion`**: wrap all non-essential animations in a media query check:
  ```ts
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!prefersReduced) { /* animate */ }
  ```
- **Only animate `transform` and `opacity`** — never animate `width`, `height`, `top`, `left` (triggers layout reflow)
- **One GSAP context per component** — batch all animations in a single `gsap.context()` or `useGSAP()` call

### Scroll animations with ScrollTrigger
```ts
useGSAP(() => {
  gsap.from('.card', {
    y: 60,
    opacity: 0,
    duration: 0.8,
    ease: 'power2.out',
    scrollTrigger: {
      trigger: '.card',
      start: 'top 80%',
      toggleActions: 'play none none reverse',
    },
  })
})
```

### Page transitions
- Use a shared `<PageTransition>` wrapper component for route changes
- Enter: `opacity: 0 → 1`, `y: 20 → 0`, duration `0.5s`, ease `expo.out`
- Exit: `opacity: 1 → 0`, duration `0.3s`, ease `power2.in`
- Coordinate with Lenis: scroll to top (`lenis.scrollTo(0, { immediate: true })`) before exit animation

### Use `/gen-animation` skill
Use the `/gen-animation` skill to generate animated components from Paper design nodes with the correct GSAP + Lenis patterns applied automatically.

---

## Testing
- Unit tests for utility functions and hooks
- Component tests for all interactive components
- E2E tests for critical user flows (login, main feature, checkout, etc.)

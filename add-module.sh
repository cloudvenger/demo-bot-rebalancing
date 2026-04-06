#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# AI Development Workflow — Add Module
# Run after setup.sh to enable modules you skipped initially.
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AI Development Workflow — Add Module"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Detection helpers ─────────────────────────────────────────────────────────

frontend_stubbed()  { grep -q "does not include a frontend layer" frontend/CLAUDE.md  2>/dev/null; }
backend_stubbed()   { grep -q "does not include a backend layer"  backend/CLAUDE.md   2>/dev/null; }
contracts_stubbed() { grep -q "does not include smart contracts"  contracts/CLAUDE.md 2>/dev/null; }
paper_disabled()    { [[ ! -f "docs/workflow/phase2-design.md" ]]; }
animation_disabled(){ [[ ! -f ".claude/skills/gen-animation/SKILL.md" ]]; }

# ── Build menu of available additions ────────────────────────────────────────

AVAILABLE=()
LABELS=()

frontend_stubbed  && AVAILABLE+=("frontend")  && LABELS+=("Frontend layer   (UI components, routing, state)")
backend_stubbed   && AVAILABLE+=("backend")   && LABELS+=("Backend layer    (API routes, database, auth)")
contracts_stubbed && AVAILABLE+=("contracts") && LABELS+=("Smart contracts  (Solidity, Hardhat/Foundry)")

if ! frontend_stubbed; then
  paper_disabled     && AVAILABLE+=("paper")     && LABELS+=("Paper MCP        (UI design phase + gen-component skill)")
  if ! paper_disabled; then
    animation_disabled && AVAILABLE+=("animation") && LABELS+=("Animation layer  (GSAP + Lenis + gen-animation skill)")
  fi
fi

if [[ ${#AVAILABLE[@]} -eq 0 ]]; then
  echo "  All modules are already enabled. Nothing to add."
  echo ""
  exit 0
fi

# ── Prompt ────────────────────────────────────────────────────────────────────

echo "  Which module would you like to add?"
echo ""
for i in "${!AVAILABLE[@]}"; do
  printf "  %d) %s\n" "$((i+1))" "${LABELS[$i]}"
done
echo ""
read -rp "Enter number: " CHOICE

if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || (( CHOICE < 1 || CHOICE > ${#AVAILABLE[@]} )); then
  echo "Error: invalid choice."
  exit 1
fi

MODULE="${AVAILABLE[$((CHOICE-1))]}"
echo ""
echo "  Adding: ${LABELS[$((CHOICE-1))]}"
echo ""

# ── Shared helpers ────────────────────────────────────────────────────────────

ask_yn() {
  local prompt="$1" default="${2:-y}" answer
  if [[ "$default" == "y" ]]; then
    read -rp "$prompt [Y/n]: " answer
  else
    read -rp "$prompt [y/N]: " answer
  fi
  answer="${answer:-$default}"
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

replace_tbd() {
  local file="$1" marker="$2" value="$3"
  [[ -n "$value" ]] && sed -i '' "s|${marker}: TBD|${marker}: ${value}|g" "$file"
}

# Insert a table row into CLAUDE.md immediately before the first line matching a pattern (idempotent)
insert_skill_row() {
  local new_row="$1" anchor_pattern="$2"
  if ! grep -qF "$new_row" CLAUDE.md 2>/dev/null; then
    awk -v row="$new_row" -v pat="$anchor_pattern" \
      '$0 ~ pat { print row } 1' \
      CLAUDE.md > /tmp/_addmod_claude.md && mv /tmp/_addmod_claude.md CLAUDE.md
  fi
}

# ── Module: backend ───────────────────────────────────────────────────────────

add_backend() {
  echo "── Backend stack ──"
  echo "(press Enter to skip any field and keep TBD)"
  echo ""
  read -rp "Runtime [e.g., Node.js, Bun, Python]: "              RUNTIME
  read -rp "Backend framework [e.g., Express, Fastify, Hono]: "  BE_FRAMEWORK
  read -rp "ORM [e.g., Prisma, Drizzle, SQLAlchemy]: "           ORM
  read -rp "Database [e.g., PostgreSQL, SQLite, MongoDB]: "       DATABASE
  read -rp "Auth strategy [e.g., JWT, session, OAuth]: "          AUTH

  cat > backend/CLAUDE.md << 'EOF'
# Backend Agent Context

Inherits all rules from root [CLAUDE.md](../CLAUDE.md). Rules below are specific to the backend layer.

---

## Responsibilities
- Database schema and migrations
- API routes and business logic
- Authentication and authorization
- Server-side validation
- Background jobs and cron tasks

---

## Stack (fill in after scaffolding)
- **Runtime**: TBD (Node.js / Bun / Python / etc.)
- **Framework**: TBD (Express / Fastify / Hono / FastAPI / etc.)
- **ORM**: TBD (Prisma / Drizzle / SQLAlchemy / etc.)
- **Database**: TBD (PostgreSQL / SQLite / etc.)
- **Auth strategy**: TBD (JWT / session / OAuth)

---

## Architecture Pattern
- **Pattern**: TBD (Controller → Service → Repository / Hexagonal / CQRS)
- **Layer responsibilities** (once pattern is chosen):
  - **Controller** (`routes/`): parse request, validate input, call service, return response — no business logic here
  - **Service** (`services/`): business logic, domain rules, orchestration — no HTTP or DB concerns here
  - **Repository** (`repositories/`): data access only — no business logic, returns domain objects

> Filled in during Phase 3 by `/plan`. Do not add business logic to controllers or HTTP calls to services.

---

## SOLID Principles

Apply SOLID at every layer. These are not optional style preferences — violations produce code that is hard to test, hard to extend, and fragile under change.

| Principle | Rule in this codebase |
|---|---|
| **S** — Single Responsibility | One class/module = one reason to change. Each controller handles one resource. Each service owns one domain concept. Each repository touches one entity. |
| **O** — Open/Closed | Services implement interfaces — adding behavior means a new implementation, not modifying existing code. Never modify a working service to add a tangentially related feature; add a new service or extend via composition. |
| **L** — Liskov Substitution | Any implementation of a service interface must be fully substitutable for another. This is what makes mocking in tests possible — if a `UserService` mock doesn't behave like the real one, the tests are meaningless. |
| **I** — Interface Segregation | Keep interfaces narrow. Don't bundle unrelated methods in one interface — split by caller use case. A read-only consumer should not depend on an interface that exposes mutating methods. |
| **D** — Dependency Inversion | Controllers depend on service **interfaces**, not concrete classes. Services depend on repository **interfaces**, not ORM classes directly. Inject dependencies via constructor — never instantiate dependencies inside a class. |

**Practical checklist before any PR:**
- [ ] Does this class/module do exactly one thing? If not, extract.
- [ ] Does this change require modifying a class that was already working? If yes, consider extending instead.
- [ ] Are concrete classes injected from outside, not instantiated inside?
- [ ] Could you swap the repository for a mock without changing the service code?

---

## API Conventions
- All routes prefixed with `/api/v1/`
- Use RESTful naming: `GET /api/v1/users`, `POST /api/v1/users`, `DELETE /api/v1/users/:id`
- Return consistent JSON shape:
  ```json
  { "data": ..., "error": null }     // success
  { "data": null, "error": "..." }   // failure
  ```
- HTTP status codes must be semantically correct (200, 201, 400, 401, 403, 404, 500)
- Never expose internal error details to the client in production

---

## Validation Rules
- Validate all inputs at the route handler level before touching the DB
- Reject unknown fields (strip or error on extra properties)
- All user-facing strings must be sanitized to prevent injection

---

## Database Rules
- All schema changes via migrations — never mutate the DB directly
- Soft-delete sensitive records (add `deleted_at` field), never hard delete
- Index all foreign keys and frequently queried fields
- No N+1 queries — batch or join where possible

---

## Security Rules
- Passwords must be hashed (bcrypt / argon2) — never stored in plain text
- JWT secrets and DB credentials live in `.env` — never in code
- Rate-limit all auth endpoints
- CORS must be explicitly configured — never use wildcard `*` in production

---

## Testing
- Unit tests for all business logic functions
- Integration tests for all API routes (happy path + error cases)
- Use test database, never the development database
EOF

  replace_tbd "backend/CLAUDE.md" "- \*\*Runtime\*\*"        "$RUNTIME"
  replace_tbd "backend/CLAUDE.md" "- \*\*Framework\*\*"      "$BE_FRAMEWORK"
  replace_tbd "backend/CLAUDE.md" "- \*\*ORM\*\*"            "$ORM"
  replace_tbd "backend/CLAUDE.md" "- \*\*Database\*\*"       "$DATABASE"
  replace_tbd "backend/CLAUDE.md" "- \*\*Auth strategy\*\*"  "$AUTH"

  echo "  ✓ backend/CLAUDE.md restored"
}

# ── Module: contracts ─────────────────────────────────────────────────────────

add_contracts() {
  echo "── Smart contract stack ──"
  echo "(press Enter to skip any field and keep TBD)"
  echo ""
  read -rp "Chain/network [e.g., Ethereum, Polygon, Base]: "  CHAIN
  read -rp "Framework [e.g., Hardhat, Foundry]: "             CONTRACT_FRAMEWORK
  read -rp "Solidity version [e.g., ^0.8.24]: "               SOLIDITY_VERSION
  read -rp "Libraries [e.g., OpenZeppelin, Solmate]: "        CONTRACT_LIBS
  echo ""

  USE_FACTORY=false
  USE_REGISTRY=false
  ask_yn "  Use Factory pattern (deploy multiple contract instances)?" n && USE_FACTORY=true || true
  ask_yn "  Use Registry pattern (contracts discover each other at runtime)?" n && USE_REGISTRY=true || true

  cat > contracts/CLAUDE.md << 'EOF'
# Contracts Agent Context

Inherits all rules from root [CLAUDE.md](../CLAUDE.md). Rules below are specific to the smart contract layer.

---

## Responsibilities
- Smart contract logic and on-chain storage
- Events, errors, and ABI design
- Access control and role management
- Upgradability strategy (if any)
- Deployment scripts and network configuration
- Contract verification on block explorers

---

## Stack (fill in after scaffolding)
- **Chain/network**: TBD (Ethereum / Polygon / Base / Arbitrum / etc.)
- **Framework**: TBD (Hardhat / Foundry)
- **Solidity version**: TBD (e.g., ^0.8.24)
- **Libraries**: TBD (OpenZeppelin / Solmate / etc.)
- **Testing approach**: TBD (Hardhat + ethers.js / Foundry forge)

---

## Architecture Pattern
- **Upgradeability**: TBD (Immutable / UUPS proxy / Transparent proxy / Diamond EIP-2535)
  - **Immutable**: no upgrade mechanism — simplest, most secure, use when contract logic is final
  - **UUPS proxy**: upgrade logic in the implementation contract — recommended for most upgradeable contracts
  - **Transparent proxy**: OpenZeppelin default — admin calls go to proxy, user calls go to impl
  - **Diamond (EIP-2535)**: modular upgrades across multiple facets — only for large, complex systems
- **Factory pattern**: TBD (Yes / No)
  - If Yes: a `Factory` contract deploys and tracks new instances; use when many identical contracts are deployed per user or entity
- **Registry pattern**: TBD (Yes / No)
  - If Yes: a `Registry` contract maps names/roles to deployed addresses; use instead of hardcoding addresses in contracts
- **Payment disbursement**: Pull payment — users call `withdraw()` themselves; never push ETH to arbitrary addresses

> Filled in during Phase 3 by `/plan` or at setup by `./setup.sh`.

---

## SOLID Principles (adapted for Solidity)

Solidity has no interfaces in the OOP sense, but SOLID still applies — especially S, I, and D, which directly affect security and upgradeability.

| Principle | Rule in this codebase |
|---|---|
| **S** — Single Responsibility | Each contract has one clear purpose. Avoid "god contracts" that combine token logic, staking logic, and governance in one file. Split by concern — the factory deploys, the registry tracks, the vault holds funds. |
| **O** — Open/Closed | Deployed contracts cannot be modified. Design for extension via proxy patterns (UUPS / Diamond) or by composing with new contracts rather than redeploying. The core logic should not need to change to add a new feature. |
| **L** — Liskov Substitution | Contracts implementing the same interface (e.g., `IERC20`) must be fully substitutable. Any contract that receives an `IERC20` address must work correctly with any compliant token — not just the one you tested with. |
| **I** — Interface Segregation | Keep Solidity interfaces minimal. Define one interface per consumer role: a contract that only reads balances should not depend on a full `IERC20` — define a slim `IBalanceOf` instead. Small interfaces reduce coupling and attack surface. |
| **D** — Dependency Inversion | Contracts depend on **interfaces**, not concrete addresses. Cross-contract dependencies are passed via constructor or registry — never hardcoded. This is also a security rule: hardcoded addresses cannot be updated if a dependency is compromised. |

**Practical checklist before any PR:**
- [ ] Does this contract do exactly one thing? If it does two, split it.
- [ ] Are all cross-contract dependencies injected via constructor or registry?
- [ ] Does this contract implement only the interface methods it actually needs?
- [ ] Could you replace a dependency contract without changing this contract's code?

---

## Contract Conventions
- NatSpec (`@notice`, `@param`, `@return`) on every public and external function
- Custom errors instead of `require` strings — more gas-efficient and machine-readable:
  ```solidity
  error Unauthorized(address caller);
  error InsufficientBalance(uint256 available, uint256 required);
  ```
- Emit an event for every state change — events are the audit log of the contract
- Document the storage layout at the top of each contract (critical for upgradeable contracts)
- Function ordering: `external` → `public` → `internal` → `private`
- Constants and immutables in `UPPER_SNAKE_CASE`
- No magic numbers — use named constants

---

## Security Rules
- **Checks-Effects-Interactions**: validate inputs, update state, then call external contracts — in that order
- `ReentrancyGuard` on any function that sends ETH or calls an untrusted external contract
- Access control via OpenZeppelin `Ownable` or `AccessControl` — never raw `msg.sender == owner` checks outside a modifier
- Never use `tx.origin` for authentication — always `msg.sender`
- No hardcoded addresses in contract code — pass them as constructor arguments or use a registry
- Integer arithmetic: Solidity ≥0.8 has built-in overflow checks — do not use SafeMath
- Pull over push for ETH payments — never push ETH to arbitrary addresses in a loop

---

## Testing
- Unit test every public/external function: happy path + all revert conditions
- Fuzz tests for any function involving arithmetic or user-supplied amounts (Foundry `forge test` or Hardhat property tests)
- Fork test: one integration test running against a mainnet/testnet fork covering a full user flow
- 100% line coverage for core contract logic — no uncovered revert branches
- Test file naming: `ContractName.t.sol` (Foundry) or `ContractName.test.ts` (Hardhat)

---

## Deployment
- All deployments via scripts — never deploy manually from a REPL
- Deployment scripts are idempotent: check if already deployed before deploying
- Verify contracts on the block explorer after every deployment
- Store deployed addresses in a `deployments/<network>.json` file — never hardcode them
- Never store private keys in code or `.env` files committed to the repo

---

## Gas Conventions
- Pack struct fields to minimize storage slots (smaller types together)
- Prefer `calldata` over `memory` for read-only function parameters
- Avoid unbounded loops — any loop over user-controlled data is a DoS vector
- Run the gas reporter after every significant change and review regressions
EOF

  replace_tbd "contracts/CLAUDE.md" "- \*\*Chain\/network\*\*"   "$CHAIN"
  replace_tbd "contracts/CLAUDE.md" "- \*\*Framework\*\*"        "$CONTRACT_FRAMEWORK"
  replace_tbd "contracts/CLAUDE.md" "- \*\*Solidity version\*\*" "$SOLIDITY_VERSION"
  replace_tbd "contracts/CLAUDE.md" "- \*\*Libraries\*\*"        "$CONTRACT_LIBS"

  if $USE_FACTORY; then
    sed -i '' 's|- \*\*Factory pattern\*\*: TBD (Yes / No)|- \*\*Factory pattern\*\*: Yes — deploy multiple instances via a factory contract|g' contracts/CLAUDE.md
  else
    sed -i '' 's|- \*\*Factory pattern\*\*: TBD (Yes / No)|- \*\*Factory pattern\*\*: No|g' contracts/CLAUDE.md
  fi

  if $USE_REGISTRY; then
    sed -i '' 's|- \*\*Registry pattern\*\*: TBD (Yes / No)|- \*\*Registry pattern\*\*: Yes — contracts discover each other via a registry|g' contracts/CLAUDE.md
  else
    sed -i '' 's|- \*\*Registry pattern\*\*: TBD (Yes / No)|- \*\*Registry pattern\*\*: No|g' contracts/CLAUDE.md
  fi

  # Restore gen-contract skill
  mkdir -p .claude/skills/gen-contract
  cat > .claude/skills/gen-contract/SKILL.md << 'EOF'
---
description: Generate a Solidity smart contract following project conventions
---

Generate a Solidity smart contract following project conventions.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Identify the contract from the arguments or ask the user:
   - What is the contract's purpose? (e.g., ERC20 token, ERC721 NFT, staking logic, governance, custom logic)
   - Does it need upgradeability? (proxy pattern or immutable)
   - What access control model? (Ownable, AccessControl, none)
3. Read `contracts/CLAUDE.md` for stack, conventions, and security rules
4. Read `SPEC.md` to understand the business logic and acceptance criteria for this contract
5. Read `PLAN.md` to verify this contract is in the architecture — flag any discrepancy before proceeding
6. Generate the contract file:
   - Solidity version pragma from `contracts/CLAUDE.md`
   - NatSpec (`@notice`, `@param`, `@return`) on all public/external functions
   - Custom errors instead of `require` strings
   - Events for every state change
   - ReentrancyGuard on functions sending ETH or calling external contracts
   - Access control pattern from `contracts/CLAUDE.md`
   - Storage layout comment at the top if the contract has non-trivial storage
   - Place in `contracts/` directory following project conventions
7. Generate a test file alongside the contract:
   - Unit tests for every function (happy path + all revert conditions)
   - At least one fuzz test for functions with user-supplied numeric inputs
   - One fork/integration test covering a full user flow
8. Run `/check` — fix any compilation errors or test failures before proceeding
9. Report: contract file path, test file path, ABI summary (functions + events), any security decisions made explicit
EOF

  # Add gen-contract row to CLAUDE.md skills table
  insert_skill_row \
    "| \`gen-contract\` | \`/gen-contract\` | Generate a Solidity smart contract following project conventions |" \
    "gen-api-route|add-test"

  echo "  ✓ contracts/CLAUDE.md restored"
  echo "  ✓ .claude/skills/gen-contract/SKILL.md restored"
  echo "  ✓ CLAUDE.md skills table updated"
}

# ── Module: frontend ──────────────────────────────────────────────────────────

add_frontend() {
  echo "── Frontend stack ──"
  echo "(press Enter to skip any field and keep TBD)"
  echo ""
  read -rp "Framework [e.g., Next.js, Vite+React, SvelteKit]: "   FRAMEWORK
  read -rp "Styling [e.g., Tailwind CSS, CSS Modules]: "           STYLING
  read -rp "State management [e.g., Zustand, Redux, Jotai]: "      STATE
  read -rp "Data fetching [e.g., React Query, SWR, tRPC]: "        DATA_FETCH
  read -rp "Testing framework [e.g., Vitest, Jest, Playwright]: "  TESTING
  echo ""

  USE_PAPER=false
  USE_ANIMATION=false
  ask_yn "Use Paper MCP for UI design (Phase 2)?" y && USE_PAPER=true || true
  if $USE_PAPER; then
    ask_yn "  Use GSAP + Lenis animation layer?" y && USE_ANIMATION=true || true
  fi

  cat > frontend/CLAUDE.md << 'EOF'
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
EOF

  # Strip Paper references if Paper is not being added
  if ! $USE_PAPER; then
    sed -i '' '/[Pp]aper/d' frontend/CLAUDE.md
    sed -i '' '/designs\/app\.paper/d' frontend/CLAUDE.md
  fi

  # Strip animation section if animation is not being added
  if ! $USE_ANIMATION; then
    python3 - << 'PYEOF'
import re, pathlib
p = pathlib.Path("frontend/CLAUDE.md")
text = p.read_text()
text = re.sub(r'\n## Animation & Motion\n.*?(?=\n## |\Z)', '', text, flags=re.DOTALL)
p.write_text(text)
PYEOF
  fi

  replace_tbd "frontend/CLAUDE.md" "- \*\*Framework\*\*"      "$FRAMEWORK"
  replace_tbd "frontend/CLAUDE.md" "- \*\*Styling\*\*"        "$STYLING"
  replace_tbd "frontend/CLAUDE.md" "- \*\*State\*\*"          "$STATE"
  replace_tbd "frontend/CLAUDE.md" "- \*\*Data fetching\*\*"  "$DATA_FETCH"
  replace_tbd "frontend/CLAUDE.md" "- \*\*Testing\*\*"        "$TESTING"

  echo "  ✓ frontend/CLAUDE.md restored"

  if $USE_PAPER; then
    _restore_paper_files "$USE_ANIMATION"
  fi
}

# ── Module: paper ─────────────────────────────────────────────────────────────

_restore_paper_files() {
  local with_animation="${1:-false}"

  cat > docs/workflow/phase2-design.md << 'EOF'
# Phase 2 — Design

**Tool: Paper (via Claude Code MCP)**

This phase converts the spec into visual UI mockups that serve as the source of truth for all frontend development.

## What happens
1. Claude Code reads `SPEC.md`
2. Calls `mcp__paper__get_guide({ topic: "web-app" })` for design system rules
3. Uses `mcp__paper__get_basic_info` to understand the current canvas state
4. Uses `mcp__paper__create_artboard` to set up a screen for each user story
5. Uses `mcp__paper__write_html` to generate screen content iteratively (one visual group per call)
6. Uses `mcp__paper__get_screenshot` to visually verify each screen
7. Uses `mcp__paper__get_computed_styles` to define and review design tokens

## Key patterns
- Each user story should map to at least one artboard
- The design system (tokens, components) is defined once and reused across all screens
- Build designs incrementally — one visual group per write_html call, screenshot after every 2–3 additions
- Screenshots are reviewed by the human at the end of the phase
- The Paper design file is saved as `designs/app.paper`

## Motion design annotations
Paper designs should include notes describing motion intent alongside static layouts. For each screen or component that moves, add a text annotation describing:

| Annotation | What to specify |
|---|---|
| **Entrance** | How the element appears (fade, slide, scale) + direction + duration |
| **Exit** | How the element leaves (fade, slide) + duration |
| **Scroll trigger** | At what scroll position the animation starts (`top 80%`, `center center`) |
| **Hover state** | Scale, color, or transform change on hover |
| **Page transition** | In/out behavior for full-page route changes |
| **Easing** | Reference the easing table in `frontend/CLAUDE.md` (e.g. `power2.out`) |

These annotations become the direct input for the `/gen-animation` skill in Phase 4.

## Deliverable
`designs/app.paper` — a Paper design file with all required screens + motion annotations, approved by the human.

## Handoff to Phase 3
The `frontend/CLAUDE.md` is updated to reference `designs/app.paper`. From this point forward, every frontend agent opens the Paper design and reads it before coding any UI.

## Intra-phase iteration
```
create_artboard → write_html (group by group) → get_screenshot → human feedback → adjust → repeat
```
EOF

  mkdir -p .claude/skills/gen-component
  cat > .claude/skills/gen-component/SKILL.md << 'EOF'
---
description: Generate a UI component from a Paper design node
argument-hint: "[ComponentName]"
---

Generate a UI component from the Paper design.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Ask the user: which screen or component node in the Paper design should be implemented?
   (or use the node name/ID provided in the arguments)
3. Use `mcp__paper__get_basic_info` to understand the canvas structure, then `mcp__paper__get_tree_summary` to explore the target artboard's hierarchy
4. Use `mcp__paper__get_screenshot` to visually inspect the design node
5. Use `mcp__paper__get_jsx` to export the JSX structure of the target node — use this as the base for the component
6. Use `mcp__paper__get_computed_styles` on key nodes to extract exact design tokens (colors, spacing, typography)
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
EOF

  # Add gen-component row to CLAUDE.md skills table
  insert_skill_row \
    "| \`gen-component\` | \`/gen-component\` | Generate a UI component from a Paper design node |" \
    "gen-api-route"

  echo "  ✓ docs/workflow/phase2-design.md restored"
  echo "  ✓ .claude/skills/gen-component/SKILL.md restored"
  echo "  ✓ CLAUDE.md: gen-component row added"

  if [[ "$with_animation" == "true" ]]; then
    _restore_animation_files
  fi
}

add_paper() {
  USE_ANIMATION=false
  ask_yn "Also add GSAP + Lenis animation layer?" y && USE_ANIMATION=true || true
  echo ""
  _restore_paper_files "$USE_ANIMATION"
}

# ── Module: animation ─────────────────────────────────────────────────────────

_restore_animation_files() {
  mkdir -p .claude/skills/gen-animation
  cat > .claude/skills/gen-animation/SKILL.md << 'EOF'
---
description: Generate a GSAP + Lenis animated component from a Paper design node
argument-hint: "[ComponentName]"
---

Generate an animated component using GSAP and Lenis based on a Paper design node.

Steps:
1. Verify the current branch is not `main` — if it is, stop and run `/new-feature` first
2. Ask the user: which component or screen needs animation? (or use the name/ID provided in arguments)
3. Read `frontend/CLAUDE.md` to load the animation conventions, easing table, and setup rules
4. Use `mcp__paper__get_basic_info` to find the target artboard, then `mcp__paper__get_node_info` to read the target node and its motion annotations
5. Use `mcp__paper__get_screenshot` to visually inspect the element to be animated
6. Use `mcp__paper__get_jsx` to export the JSX structure of the target node as a starting point
7. Identify the animation type from the design annotations:
   - **Entrance**: element appears on mount or scroll — use `gsap.from()` with ScrollTrigger
   - **Exit**: element leaves on unmount or route change — use `gsap.to()` in cleanup
   - **Scroll-driven**: parallax or reveal on scroll — use ScrollTrigger with `scrub`
   - **Hover**: interactive state change — use `gsap.to()` inside event handlers
   - **Page transition**: full-page route in/out — use a GSAP timeline with enter/leave callbacks
7. Generate the component file following these rules:
   - Use `useGSAP()` from `@gsap/react` (never raw `useEffect`)
   - Only animate `transform` and `opacity`
   - Use the easing from `frontend/CLAUDE.md` that matches the animation type
   - Wrap in `prefers-reduced-motion` check — provide a no-motion fallback
   - For scroll animations: set `scrollTrigger.kill()` in the cleanup
   - Lenis is never instantiated here — import from `lib/motion.ts` if scroll position is needed
8. If the component requires Lenis scroll coordination (e.g., scrollTo on page transition):
   - Import `lenis` from `lib/motion.ts`
   - Call `lenis.scrollTo(0, { immediate: true })` before exit animations
9. Place the file in the correct directory following project conventions
10. Run `/check` — fix any failures before proceeding
11. Report: file path, animation type applied, easing used, any design annotations that were unclear
EOF

  # Restore animation section in phase4-build.md (before ## Build conventions)
  if [[ -f "docs/workflow/phase4-build.md" ]] && ! grep -q "Animation implementation" docs/workflow/phase4-build.md 2>/dev/null; then
    python3 - << 'PYEOF'
import pathlib
p = pathlib.Path("docs/workflow/phase4-build.md")
text = p.read_text()
animation_section = """
## Animation implementation
When a component has motion annotations in the Paper design:
1. Use `/gen-animation <ComponentName>` to scaffold the animated version
2. The skill reads the design node, extracts the motion annotations, and produces the GSAP + Lenis code
3. All animations must follow the conventions in `frontend/CLAUDE.md` (easing table, `useGSAP()`, `prefers-reduced-motion`)
4. Lenis is initialized once at app root (`lib/motion.ts`) — never per component

Animation tasks follow the same sizing rule: one animation task = one component or one page transition.

"""
anchor = "\n## Build conventions"
if anchor in text:
    text = text.replace(anchor, animation_section + anchor)
    p.write_text(text)
PYEOF
  fi

  # Add gen-animation row to CLAUDE.md skills table (after gen-component, before gen-api-route)
  insert_skill_row \
    "| \`gen-animation\` | \`/gen-animation\` | Generate a GSAP + Lenis animated component from a Paper design node |" \
    "gen-api-route"

  echo "  ✓ .claude/skills/gen-animation/SKILL.md restored"
  echo "  ✓ docs/workflow/phase4-build.md animation section restored"
  echo "  ✓ CLAUDE.md: gen-animation row added"
}

add_animation() {
  _restore_animation_files
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$MODULE" in
  frontend)  add_frontend  ;;
  backend)   add_backend   ;;
  contracts) add_contracts ;;
  paper)     add_paper     ;;
  animation) add_animation ;;
esac

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Any TBD fields you skipped can be filled in manually"
echo "  in the relevant CLAUDE.md file, or during Phase 3 (/plan)."
echo ""
echo "  Run this script again to add more modules."
echo ""

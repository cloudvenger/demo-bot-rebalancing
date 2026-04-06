# Project Context — Morpho V2 Rebalancing Bot

## What is this project?
A backend-only bot that automates allocation rebalancing for a Morpho Vault V2, optimizing yield across Morpho Blue markets on Ethereum mainnet.

Full workflow reference: [docs/workflow.md](docs/workflow.md)

---

## Key Files
| File | Purpose |
|---|---|
| `SPEC.md` | Product spec — source of truth for requirements |
| `PLAN.md` | Technical architecture and task breakdown |
| `task.md` | Granular task checklist, updated as work progresses |
| `docs/architecture.md` | Service architecture diagrams and patterns |

---

## Stack

- **Runtime**: Bun (native TypeScript, fast startup)
- **Framework**: Fastify (structured plugins, JSON schema validation, Pino logging)
- **Chain interaction**: viem + `@morpho-org/blue-sdk` + `@morpho-org/blue-sdk-viem`
- **Scheduler**: croner (lightweight cron for Bun)
- **Testing**: Vitest + Anvil (forked mainnet for integration tests)
- **Config validation**: zod (runtime schema validation for env vars)
- **Logging**: Pino (Fastify-native, structured JSON logs)
- **Telegram**: Direct Bot API via fetch (no heavy SDK dependency)
- **Database**: None in v1 — on-chain is the data source. Database for historical analytics is a v2 candidate.

---

## Architecture Pattern

- **Pattern**: Service-oriented — per [docs/architecture.md](docs/architecture.md)
- **Layer responsibilities**:
  - **Plugins** (`src/plugins/`): HTTP routes and cron registration — no business logic here
  - **Services** (`src/services/`): orchestration (read → compute → execute → notify) — owns the rebalance flow
  - **Core / Strategy** (`src/core/rebalancer/`): pure functions — scoring, delta computation, IRM simulation — no async, no side effects
  - **Core / Chain** (`src/core/chain/`): on-chain reads and transaction submission — all viem interaction lives here
  - **Notifier** (`src/services/notifier.ts`): Telegram alerts — fire-and-forget, never blocks rebalancing

> Do not add chain interaction to strategy logic. Do not add business logic to plugins.

---

## SOLID Principles

| Principle | Rule in this codebase |
|---|---|
| **S** — Single Responsibility | One module = one reason to change. ChainReader reads state. Strategy computes. Executor submits. Notifier alerts. |
| **O** — Open/Closed | Strategy scoring can be extended by adding new scoring factors without modifying the core `computeRebalance` function. |
| **L** — Liskov Substitution | Executor interface must work identically in live mode and dry-run mode — callers should not know which they're using. |
| **I** — Interface Segregation | ChainReader exposes separate read methods (vault state, market data, IRM params) — consumers import only what they need. |
| **D** — Dependency Inversion | Services depend on interfaces, not concrete classes. RebalanceService receives ChainReader, Strategy, Executor, and Notifier via constructor injection. |

**Practical checklist before any PR:**
- [ ] Does this module do exactly one thing? If not, extract.
- [ ] Are concrete classes injected from outside, not instantiated inside?
- [ ] Could you swap the Executor for a dry-run mock without changing the service code?
- [ ] Is Strategy still pure (no await, no RPC calls)?

---

## API Conventions
- Health check at `/health` (outside `/api/v1/` prefix)
- All other routes prefixed with `/api/v1/`
- Return consistent JSON shape:
  ```json
  { "data": ..., "error": null }     // success
  { "data": null, "error": "..." }   // failure
  ```
- HTTP status codes must be semantically correct (200, 409, 500, 503)
- Never expose internal error details (RPC URLs, private key fragments) to the client

---

## Security Rules
- `PRIVATE_KEY` and `TELEGRAM_BOT_TOKEN` must never be logged, even at debug level
- All secrets live in `.env` — never in code
- Gas ceiling enforced before every transaction — never submit at unbounded gas price
- EIP-1559 pricing only — use `maxFeePerGas` ceiling
- No `eval()` or dynamic code execution
- All user inputs validated before use
- Error messages do not expose internal details

---

## Testing
- Unit tests for all strategy/scoring functions (pure, no chain dependency)
- Integration tests for chain reader against Anvil fork
- Integration tests for API routes (health, status, rebalance trigger)
- Test file naming: `*.test.ts` co-located with source or in `__tests__/`
- All new features require at least one test

---

## Agent Rules
- Always read `SPEC.md` and `PLAN.md` before starting any new feature
- **Never commit directly to `main`** — every codebase change must go through a branch → PR → merge flow
- Create a branch before writing any code, open a PR when done, and only merge after human approval
- Never run destructive git operations without user confirmation
- When a task is complete, update `task.md` to mark it done
- Keep changes scoped — do not refactor unrelated code while implementing a feature
- **Ask the user rather than guess** when requirements are unclear — do not assume intent

For branching conventions and PR rules: @docs/workflow/git-strategy.md

---

## Conventions & Quality

> Coding conventions, security checklist, and test rules auto-load from `.claude/rules/` each session.
> Hooks in `.claude/hooks/` enforce: no commits to main, no debug statements, no hardcoded secrets.

---

## Available Skills

Run `/help` for an interactive overview of all commands, phases, and modes.
Full skill reference: @docs/workflow/cli-patterns.md

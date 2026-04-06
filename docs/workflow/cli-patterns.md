# CLI Patterns — Using the Terminal Effectively

Claude Code's CLI capabilities are a force multiplier during development. Use background processes, watch modes, and parallel commands to maintain a tight feedback loop.

## Running a dev server in background
Start the dev server once and keep it running while you iterate:
```
Run the dev server in the background, then implement the next task.
Check the terminal output if something breaks.
```

Claude Code can run long-lived processes in the background and monitor their output without blocking the main conversation.

## Watch mode for tests
Run tests in watch mode so every code change is immediately validated:
```
Run tests in watch mode in the background.
Implement feat/user-auth. Check test output after each change.
```

## Linting and type-checking as a gate
Before marking any task complete, run lint and type-check:
```
Run lint and type-check. Fix any errors before continuing.
```

This should be automatic — encode it in the build conventions and the `/review-phase` skill.

## Useful CLI patterns for agents

| Pattern | When to use | Example |
|---|---|---|
| Background server | During Phase 4 build loop | `npm run dev` in background |
| Watch tests | While implementing features | `vitest --watch` in background |
| Lint + typecheck | Before every commit | `npm run lint && npm run typecheck` |
| DB migrations | After schema changes | `npx prisma migrate dev` |
| Build check | Before PR | `npm run build` |
| Port check | When server won't start | `lsof -i :3000` |

## Parallel CLI tasks
Claude Code can run multiple background processes simultaneously:
```
Start the backend server on port 3001 and the frontend dev server on port 3000,
both in the background. Then implement the dashboard page.
```

---

## Justfile — semantic command interface for humans and AI agents

Every project in this workflow includes a `justfile` at the repo root.
It provides a **stable, named set of recipes** that both humans and AI agents can discover and run without reading documentation.

### Why it matters for AI agents

- `just -l` → lists every available operation instantly (agents self-orient without guessing)
- Named recipes express intent: `just check` is clearer than `npm run lint && npm run typecheck && npm test`
- Skills call `just check`, `just build`, `just test` uniformly — regardless of whether the project uses npm, bun, pnpm, or yarn
- The justfile is the **per-project adapter**: it maps semantic commands to the actual shell invocations

### Standard recipes

| Recipe | What it does |
|---|---|
| `just` or `just -l` | List all available recipes |
| `just install` | Install dependencies |
| `just dev` | Start development server |
| `just build` | Build for production |
| `just test` | Run test suite |
| `just lint` | Run linter |
| `just typecheck` | Run type checker |
| `just check` | Quality gate: lint + typecheck + test (**used by `/check`**) |
| `just ci` | Full CI pipeline: install + check + build |
| `just clean` | Remove build artifacts |

### Project-specific additions

Append stack-specific recipes below the standard ones. Examples:
```makefile
# Next.js + Prisma
db-migrate:
    npm run prisma:migrate

db-generate:
    npm run prisma:generate

# Vite
preview:
    npm run preview

# Custom validation
verify:
    npm run verify:raw
```

### Installation

```bash
# macOS
brew install just

# Ubuntu / Debian
apt install just

# Any platform (requires Rust)
cargo install just

# More options: https://github.com/casey/just#installation
```

### Adding custom recipes

Add any project-specific command as a recipe. Use `just -l` to verify it appears in the list.
AI agents will discover it automatically on next session start.

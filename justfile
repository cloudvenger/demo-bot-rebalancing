# justfile — project command runner
# Requires: just — https://github.com/casey/just
# Install:  brew install just  (macOS)
#           apt install just   (Ubuntu/Debian)
#           cargo install just (any platform with Rust)
#
# Run `just` or `just --list` to see all available recipes.

set shell := ["bash", "-cu"]
set dotenv-load := true

# Show all available recipes
default:
    @just --list

# ── Dependencies ──────────────────────────────────

# Install project dependencies
install:
    bun install

# ── Development ───────────────────────────────────

# Start development server
dev:
    bun run src/index.ts

# Build for production
build:
    bun build src/index.ts --outdir dist --target bun

# ── Quality gate ──────────────────────────────────

# Run linter / type checker
lint:
    bun run lint

# Run type checker
typecheck:
    bun run typecheck

# Run tests
test:
    bun run test

# Quality gate: lint + typecheck + test  ← used by /check skill
check: lint typecheck test

# ── CI ────────────────────────────────────────────

# Full CI pipeline: install + check + build
ci: install check build

# ── Cleanup ───────────────────────────────────────

# Remove build artifacts
clean:
    rm -rf dist

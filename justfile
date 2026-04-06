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
    npm install

# ── Development ───────────────────────────────────

# Start development server
dev:
    npm run dev

# Build for production
build:
    npm run build

# ── Quality gate ──────────────────────────────────

# Run linter (used by `just check`)
lint:
    npm run lint

# Run type checker (used by `just check`)
typecheck:
    npm run typecheck

# Run tests (used by `just check`)
test:
    npm run test

# Quality gate: lint + typecheck + test  ← used by /check skill
check: lint typecheck test

# ── CI ────────────────────────────────────────────

# Full CI pipeline: install + check + build
ci: install check build

# ── Cleanup ───────────────────────────────────────

# Remove build artifacts
clean:
    rm -rf dist .next .turbo

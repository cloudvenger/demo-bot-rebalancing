#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────
# AI Development Workflow — Interactive Setup
# Fills in TBD placeholders and removes unused
# workflow modules based on your project needs.
# ─────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AI Development Workflow — Project Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Project name ──────────────────────────────────

read -rp "Project name: " PROJECT_NAME
if [[ -z "$PROJECT_NAME" ]]; then
  echo "Error: project name is required."
  exit 1
fi

# ── Workflow modules ───────────────────────────────

echo ""
echo "── Workflow modules ──"
echo "These choices determine which phases, docs, and skills are included."
echo ""

ask_yn() {
  local prompt="$1"
  local default="${2:-y}"
  local answer
  if [[ "$default" == "y" ]]; then
    read -rp "$prompt [Y/n]: " answer
    answer="${answer:-y}"
  else
    read -rp "$prompt [y/N]: " answer
    answer="${answer:-n}"
  fi
  answer_lower=$(echo "$answer" | tr '[:upper:]' '[:lower:]')
  [[ "$answer_lower" == "y" || "$answer_lower" == "yes" ]]
}

# ── Check / install just ───────────────────────────

if ! command -v just &>/dev/null; then
  echo ""
  echo "  'just' task runner is not installed."
  if command -v brew &>/dev/null; then
    ask_yn "  Install just via Homebrew now?" y \
      && brew install just \
      || echo "  ⚠  Skipping — install manually: brew install just"
  else
    echo "  Install manually:"
    echo "    macOS:  brew install just"
    echo "    Linux:  apt install just  OR  cargo install just"
    echo "    Docs:   https://github.com/casey/just#installation"
  fi
fi

USE_ANTIGRAVITY=false
USE_IDEATE=true
USE_FRONTEND=true
USE_PAPER=true
USE_ANIMATION=true
USE_BACKEND=true
USE_FULLSTACK=false
USE_CONTRACTS=false
USE_FACTORY=false
USE_REGISTRY=false

echo "Ideation method for Phase 1:"
echo "  1) Antigravity  — external AI ideation tool (richer back-and-forth)"
echo "  2) /ideate      — Claude Code native, stays in-editor, produces SPEC.md"
echo "  3) Manual       — copy templates/SPEC.template.md and fill in yourself"
echo ""
read -rp "Choice [1/2/3] (default: 2): " IDEATE_CHOICE
IDEATE_CHOICE="${IDEATE_CHOICE:-2}"
case "$IDEATE_CHOICE" in
  1) USE_ANTIGRAVITY=true; USE_IDEATE=false ;;
  3) USE_IDEATE=false ;;  # manual
  *) ;;  # 2 or anything else → keep USE_IDEATE=true
esac
ask_yn "Does this project include a frontend UI?" y  && USE_FRONTEND=true    || USE_FRONTEND=false

if $USE_FRONTEND; then
  ask_yn "  Use Paper MCP for UI design (Phase 2)?" y && USE_PAPER=true  || USE_PAPER=false
  if $USE_PAPER; then
    ask_yn "  Use GSAP + Lenis animation layer?" y && USE_ANIMATION=true || USE_ANIMATION=false
  else
    USE_ANIMATION=false
  fi
else
  USE_PAPER=false
  USE_ANIMATION=false
fi

ask_yn "Does this project include a backend?" y && USE_BACKEND=true || USE_BACKEND=false
ask_yn "Does this project include smart contracts (Solidity)?" n && USE_CONTRACTS=true || USE_CONTRACTS=false

if $USE_CONTRACTS; then
  ask_yn "  Use Factory pattern (deploy multiple contract instances)?" n && USE_FACTORY=true || USE_FACTORY=false
  ask_yn "  Use Registry pattern (contracts discover each other at runtime)?" n && USE_REGISTRY=true || USE_REGISTRY=false
fi

# ── Stack choices ──────────────────────────────────

echo ""
echo "── Stack choices ──"
echo "(press Enter to skip any choice and keep TBD)"
echo ""

read -rp "Framework [e.g., Next.js, Vite+React, SvelteKit, Nuxt, Remix]: " FRAMEWORK

# Auto-detect fullstack frameworks (co-located frontend + backend)
if [[ -n "$FRAMEWORK" ]]; then
  fw_lower=$(echo "$FRAMEWORK" | tr '[:upper:]' '[:lower:]')
  for fs in "next" "sveltekit" "nuxt" "remix" "analog"; do
    if [[ "$fw_lower" == *"$fs"* ]]; then
      USE_FULLSTACK=true
      USE_BACKEND=true  # fullstack always implies backend work
      echo "  → Fullstack framework detected: frontend and backend are co-located."
      break
    fi
  done
fi

read -rp "Database [e.g., PostgreSQL, SQLite, MongoDB]: " DATABASE
read -rp "ORM [e.g., Prisma, Drizzle, SQLAlchemy]: " ORM
read -rp "Auth strategy [e.g., JWT, session, OAuth]: " AUTH
read -rp "Testing framework [e.g., Vitest, Jest, Playwright]: " TESTING
read -rp "Styling [e.g., Tailwind CSS, CSS Modules, styled-components]: " STYLING

RUNTIME=""
BACKEND_FRAMEWORK=""
STATE=""
DATA_FETCHING=""
CHAIN=""
CONTRACT_FRAMEWORK=""
SOLIDITY_VERSION=""
CONTRACT_LIBS=""

if $USE_BACKEND; then
  echo ""
  if $USE_FULLSTACK; then
    echo "── Backend details (co-located in $FRAMEWORK) ──"
  else
    echo "── Backend details ──"
  fi
  echo ""
  read -rp "Runtime [e.g., Node.js, Bun, Python]: " RUNTIME
  if $USE_FULLSTACK; then
    BACKEND_FRAMEWORK="$FRAMEWORK"  # same app — no separate server framework
    echo "  (backend framework = $FRAMEWORK — Route Handlers / Server Actions)"
  else
    read -rp "Backend framework [e.g., Express, Fastify, Hono, FastAPI]: " BACKEND_FRAMEWORK
  fi
fi

if $USE_FRONTEND; then
  echo ""
  echo "── Frontend details ──"
  echo ""
  read -rp "State management [e.g., Zustand, Redux, Jotai, Context]: " STATE
  read -rp "Data fetching [e.g., React Query, SWR, tRPC]: " DATA_FETCHING
fi

if $USE_CONTRACTS; then
  echo ""
  echo "── Smart contract details ──"
  echo ""
  read -rp "Chain/network [e.g., Ethereum, Polygon, Base, Arbitrum]: " CHAIN
  read -rp "Framework [e.g., Hardhat, Foundry]: " CONTRACT_FRAMEWORK
  read -rp "Solidity version [e.g., ^0.8.24]: " SOLIDITY_VERSION
  read -rp "Libraries [e.g., OpenZeppelin, Solmate]: " CONTRACT_LIBS
fi

# ── Apply stack to CLAUDE.md files ────────────────

echo ""
echo "Applying configuration..."

# Helper: replace TBD only if user provided a value
replace_tbd() {
  local file="$1"
  local marker="$2"
  local value="$3"
  if [[ -n "$value" ]]; then
    sed -i '' "s|${marker}: TBD|${marker}: ${value}|g" "$file"
  fi
}

# Root CLAUDE.md
replace_tbd "CLAUDE.md" "- \*\*Framework\*\*" "$FRAMEWORK"
replace_tbd "CLAUDE.md" "- \*\*Database\*\*" "$DATABASE"
replace_tbd "CLAUDE.md" "- \*\*Auth\*\*" "$AUTH"
replace_tbd "CLAUDE.md" "- \*\*Testing\*\*" "$TESTING"
replace_tbd "CLAUDE.md" "- \*\*Styling\*\*" "$STYLING"

if $USE_BACKEND; then
  replace_tbd "backend/CLAUDE.md" "- \*\*Runtime\*\*" "$RUNTIME"
  replace_tbd "backend/CLAUDE.md" "- \*\*Framework\*\*" "$BACKEND_FRAMEWORK"
  replace_tbd "backend/CLAUDE.md" "- \*\*ORM\*\*" "$ORM"
  replace_tbd "backend/CLAUDE.md" "- \*\*Database\*\*" "$DATABASE"
  replace_tbd "backend/CLAUDE.md" "- \*\*Auth strategy\*\*" "$AUTH"
fi

if $USE_FRONTEND; then
  replace_tbd "frontend/CLAUDE.md" "- \*\*Framework\*\*" "$FRAMEWORK"
  replace_tbd "frontend/CLAUDE.md" "- \*\*Styling\*\*" "$STYLING"
  replace_tbd "frontend/CLAUDE.md" "- \*\*State\*\*" "$STATE"
  replace_tbd "frontend/CLAUDE.md" "- \*\*Data fetching\*\*" "$DATA_FETCHING"
  replace_tbd "frontend/CLAUDE.md" "- \*\*Testing\*\*" "$TESTING"
fi

# Update project name in CLAUDE.md
sed -i '' "s|This repo demonstrates and applies a state-of-the-art AI-assisted development workflow.|${PROJECT_NAME} — built with the AI-assisted development workflow.|g" CLAUDE.md

# Fullstack: annotate both CLAUDE.md files with co-location note
if $USE_FULLSTACK; then
  python3 -c "
import pathlib, sys
framework = sys.argv[1]

p = pathlib.Path('backend/CLAUDE.md')
text = p.read_text()
note = (
  '\n> **Fullstack mode — ' + framework + '**: There is no standalone backend server. '
  'API routes (Route Handlers) and Server Actions are co-located with the frontend in '
  'the same \`app/\` directory. The Controller\u2192Service\u2192Repository pattern still applies '
  'for service and repository layers \u2014 only the entry point changes.\n'
)
text = text.replace('## Responsibilities\n', '## Responsibilities\n' + note, 1)
p.write_text(text)

p = pathlib.Path('frontend/CLAUDE.md')
text = p.read_text()
note = (
  '\n> **Fullstack mode — ' + framework + '**: Server Components, Server Actions, and '
  'Route Handlers are co-located with UI components in the same \`app/\` directory. '
  'The backend agent works in this same repo \u2014 coordinate on shared types and API contracts.\n'
)
text = text.replace('## Responsibilities\n', '## Responsibilities\n' + note, 1)
p.write_text(text)
" "$FRAMEWORK"
fi

# ── Remove unused workflow modules ────────────────

echo "Removing unused workflow modules..."

# Manual path only: strip the phase1 doc down to manual instructions
# Antigravity and /ideate paths keep the full two-path doc as-is
if ! $USE_ANTIGRAVITY && ! $USE_IDEATE; then
  cat > docs/workflow/phase1-ideate.md << 'DOCEOF'
# Phase 1 — Ideation & Product Definition

This phase transforms a raw idea into a structured, machine-readable specification that AI agents can consume.

## What happens
1. Define your project idea and goals
2. Copy `templates/SPEC.template.md` to `SPEC.md` at the project root
3. Fill in all sections of `SPEC.md` manually

> **Tip:** You can also run `/ideate` inside Claude Code for an interactive discovery session that produces SPEC.md automatically.

## What SPEC.md must contain
- **Problem statement**: one paragraph describing the user problem being solved
- **User stories**: written as "As a [persona], I want to [action] so that [benefit]"
- **Acceptance criteria**: per story, the conditions that must be true for the story to be complete
- **Out of scope**: explicit list of what is NOT being built in this iteration
- **Technical constraints**: known limitations (budget, existing systems, required integrations)

## Template
A ready-to-use template is available at [`templates/SPEC.template.md`](../../templates/SPEC.template.md).
Copy it to your project root as `SPEC.md` and fill in each section.

## Deliverable
`SPEC.md` — approved by the human before Phase 2 begins.

## Why this matters
Every agent spawned throughout the project reads `CLAUDE.md`, which references `SPEC.md`.
Without this file, agents have no context for *what* they are building.
DOCEOF
fi

# No frontend: remove design phase, design-dependent skills, frontend agent, and stub frontend layer
if ! $USE_FRONTEND; then
  rm -f docs/workflow/phase2-design.md
  rm -rf .claude/skills/gen-component
  rm -rf .claude/skills/gen-animation
  rm -rf .claude/agents/frontend
  rm -rf .claude/agents/visual
  printf '# Frontend Agent Context\n\nThis project does not include a frontend layer.\n' > frontend/CLAUDE.md
  sed -i '' '/gen-component/d' CLAUDE.md
  sed -i '' '/gen-animation/d' CLAUDE.md
elif ! $USE_PAPER; then
  # Frontend yes, Paper no: remove design phase, design-dependent skills, and visual agent
  rm -f docs/workflow/phase2-design.md
  rm -rf .claude/skills/gen-component
  rm -rf .claude/skills/gen-animation
  rm -rf .claude/agents/visual
  sed -i '' '/gen-component/d' CLAUDE.md
  sed -i '' '/gen-animation/d' CLAUDE.md
  if [[ -f frontend/CLAUDE.md ]]; then
    sed -i '' '/[Pp]aper/d' frontend/CLAUDE.md
    sed -i '' '/designs\/app\.paper/d' frontend/CLAUDE.md
  fi
elif ! $USE_ANIMATION; then
  # Paper yes, animation no: remove animation skill and strip animation section from phase4
  rm -rf .claude/skills/gen-animation
  sed -i '' '/gen-animation/d' CLAUDE.md
  python3 - << 'PYEOF'
import re, pathlib
p = pathlib.Path("docs/workflow/phase4-build.md")
text = p.read_text()
text = re.sub(r'\n## Animation implementation\n.*?(?=\n## |\Z)', '', text, flags=re.DOTALL)
p.write_text(text)
PYEOF
fi

# No backend: stub out backend layer, remove backend agent and api route skill
if ! $USE_BACKEND; then
  rm -rf .claude/agents/backend
  rm -rf .claude/skills/gen-api-route
  printf '# Backend Agent Context\n\nThis project does not include a backend layer.\n' > backend/CLAUDE.md
  sed -i '' '/gen-api-route/d' CLAUDE.md
fi

# Smart contracts: fill in TBDs or stub
if $USE_CONTRACTS; then
  replace_tbd "contracts/CLAUDE.md" "- \*\*Chain\/network\*\*" "$CHAIN"
  replace_tbd "contracts/CLAUDE.md" "- \*\*Framework\*\*" "$CONTRACT_FRAMEWORK"
  replace_tbd "contracts/CLAUDE.md" "- \*\*Solidity version\*\*" "$SOLIDITY_VERSION"
  replace_tbd "contracts/CLAUDE.md" "- \*\*Libraries\*\*" "$CONTRACT_LIBS"
  # Fill in architecture pattern choices
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
else
  rm -rf .claude/agents/contracts
  printf '# Contracts Agent Context\n\nThis project does not include smart contracts.\n' > contracts/CLAUDE.md
  rm -rf .claude/skills/gen-contract
  sed -i '' '/gen-contract/d' CLAUDE.md
fi

# ── Generate justfile ─────────────────────────────

echo ""
if ask_yn "Generate a justfile task runner? (recommended for AI agent discoverability)" y; then
  # Detect package manager
  if [[ -f "bun.lockb" ]]; then PKG="bun"
  elif [[ -f "yarn.lock" ]]; then PKG="yarn"
  elif [[ -f "pnpm-lock.yaml" ]]; then PKG="pnpm"
  else PKG="npm"
  fi

  sed "s/{{pkg}}/$PKG/g" templates/justfile.template > justfile

  # Append Vite-specific recipe if framework is Vite-based
  if [[ -n "$FRAMEWORK" ]] && echo "$FRAMEWORK" | grep -qi "vite"; then
    cat >> justfile << 'JEOF'

# Preview production build locally
preview:
    {{PKG}} run preview
JEOF
    sed -i '' "s/{{PKG}}/$PKG/g" justfile
  fi

  # Append Prisma recipes if ORM is Prisma
  if [[ -n "$ORM" ]] && echo "$ORM" | grep -qi "prisma"; then
    cat >> justfile << 'JEOF'

# ── Database (Prisma) ─────────────────────────────

# Run pending migrations
db-migrate:
    npx prisma migrate dev

# Regenerate Prisma client
db-generate:
    npx prisma generate

# Open Prisma Studio GUI
db-studio:
    npx prisma studio
JEOF
  fi

  echo "  ✓ justfile generated (package manager: $PKG)"
  echo "    Run 'just' or 'just --list' to see all recipes."
fi

# ── Summary of removed modules ────────────────────

NOTED=()
$USE_FULLSTACK && NOTED+=("Fullstack mode ($FRAMEWORK) — backend and frontend agents share the same app directory; no standalone server")

REMOVED=()
if ! $USE_ANTIGRAVITY && ! $USE_IDEATE; then
  REMOVED+=("Antigravity + /ideate — Phase 1 simplified to manual SPEC.md (tip: run /ideate anytime to switch)")
elif ! $USE_ANTIGRAVITY && $USE_IDEATE; then
  REMOVED+=("Antigravity — using /ideate for Phase 1 ideation instead")
fi
$USE_PAPER      || REMOVED+=("Paper design — Phase 2 docs and gen-component/gen-animation skills removed")
$USE_ANIMATION   || { $USE_PAPER && REMOVED+=("GSAP + Lenis animation — animation section and gen-animation skill removed"); }
$USE_BACKEND     || REMOVED+=("Backend layer — backend/CLAUDE.md stubbed, gen-api-route skill removed")
$USE_FRONTEND    || REMOVED+=("Frontend layer — frontend/CLAUDE.md stubbed, design skills removed")
$USE_CONTRACTS   || REMOVED+=("Smart contracts — contracts/CLAUDE.md stubbed, gen-contract skill removed")

# ── Next steps ────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Next steps:"
echo "  1. Copy templates/SPEC.template.md → SPEC.md"

if $USE_ANTIGRAVITY; then
  echo "  2. Run Antigravity → save output as SPEC.md"
elif $USE_IDEATE; then
  echo "  2. Run /ideate in Claude Code to produce SPEC.md interactively"
else
  echo "  2. Fill in SPEC.md manually (or run /ideate anytime)"
fi

if $USE_PAPER; then
  echo "  3. Open Claude Code (with Paper app open) → ask it to design screens from SPEC.md (Phase 2)"
  echo "  4. Run /plan to produce PLAN.md (Phase 3)"
else
  echo "  3. Run /plan to produce PLAN.md (Phase 3)"
fi

echo ""
echo "  Any TBD fields you skipped can be filled in manually"
echo "  or during Phase 3 (Architecture)."
echo ""

if [[ ${#NOTED[@]} -gt 0 ]]; then
  echo "  Notes:"
  for item in "${NOTED[@]}"; do
    echo "    ℹ  $item"
  done
  echo ""
fi

if [[ ${#REMOVED[@]} -gt 0 ]]; then
  echo "  Removed modules:"
  for item in "${REMOVED[@]}"; do
    echo "    - $item"
  done
  echo ""
fi

# ── Cleanup template files ─────────────────────────

echo "Cleaning up template files..."
rm -f README.md
[ -f SPEC.md ]   && rm -f SPEC.md
[ -f PLAN.md ]   && rm -f PLAN.md
echo "  Removed: README.md (write your own), SPEC.md, PLAN.md if present"
echo "  → Create your README.md once you have a product description"

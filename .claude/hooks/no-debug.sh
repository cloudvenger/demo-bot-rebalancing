#!/usr/bin/env bash
# PostToolUse: Edit|Write — warn about debug statements left in source files.
# Non-blocking (exit 0) — prints a warning to remind Claude to clean up.

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE" ] && exit 0

# Only check source code files — skip tests, node_modules, lock files
case "$FILE" in
  *.test.*|*.spec.*|*__tests__*|*node_modules*|*.lock|*.json|*.md|*.env*) exit 0 ;;
  *.js|*.ts|*.jsx|*.tsx|*.py|*.go|*.rs|*.rb|*.php) ;;
  *) exit 0 ;;
esac

FOUND=$(grep -nE "(console\.(log|warn|error|debug|info)|debugger\b|print\(|dbg!\(|println!\()" "$FILE" 2>/dev/null | head -5)

if [ -n "$FOUND" ]; then
  echo "⚠ Debug statements found in ${FILE}:" >&2
  echo "$FOUND" >&2
  echo "Remove before committing — /ship will be blocked by the security checklist." >&2
fi

exit 0

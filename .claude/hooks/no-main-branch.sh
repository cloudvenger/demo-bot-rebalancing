#!/usr/bin/env bash
# PreToolUse: Bash — block git commit directly on main/master
# Exit 2 blocks the action and shows the message to Claude.

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

case "$CMD" in
  *"git commit"*)
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
      echo "Blocked: direct commits to '$BRANCH' are not allowed." >&2
      echo "Create a feature branch first: /new-feature" >&2
      exit 2
    fi
    ;;
esac

exit 0

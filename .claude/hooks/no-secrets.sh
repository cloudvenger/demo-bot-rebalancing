#!/usr/bin/env bash
# PreToolUse: Write — block writes that contain hardcoded secrets or API keys.
# Exit 2 blocks the write and shows the message to Claude.

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# Skip files that legitimately contain example/template secrets
case "$FILE" in
  *.env.example|*.env.template|*CLAUDE*|*.md|*README*|*template*|*example*) exit 0 ;;
esac

# Patterns for real secrets (not env var references like $SECRET or process.env.SECRET)
if echo "$CONTENT" | grep -qE \
  '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|AKIA[0-9A-Z]{16}|xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+|["\x27]Bearer [a-zA-Z0-9\-_.]{30,}["\x27])'; then
  echo "Blocked: hardcoded API key or token detected in ${FILE}." >&2
  echo "Use environment variables (process.env.SECRET / os.environ['SECRET']) instead." >&2
  exit 2
fi

exit 0

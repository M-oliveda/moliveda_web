#!/usr/bin/env bash
# PreToolUse hook (AGENTS.md, Mandatory Rule 6): reject Edit, MultiEdit and
# Write calls that add ESLint suppression comments to code files. Only new
# suppressions are blocked, so editing near an existing one still works.
# Exit 2 blocks the tool call and shows stderr to the agent.
set -euo pipefail

INPUT=$(cat)
TOOL=$(jq -r '.tool_name // empty' <<<"$INPUT")
FILE_PATH=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")

case "$FILE_PATH" in
  *.js | *.jsx | *.mjs | *.cjs | *.ts | *.tsx | *.mts | *.cts) ;;
  *) exit 0 ;;
esac

# `eslint-disable*` directives and `/* eslint rule: off */` block configs.
PATTERN='eslint-disable|/\*[[:space:]]*eslint[[:space:]]'

count() {
  # grep exits 1 when nothing matches; that is a count of zero, not an error.
  { grep -Eo "$PATTERN" || true; } | wc -l | tr -d ' '
}

case "$TOOL" in
  Edit)
    BEFORE=$(jq -r '.tool_input.old_string // ""' <<<"$INPUT" | count)
    AFTER=$(jq -r '.tool_input.new_string // ""' <<<"$INPUT" | count)
    ;;
  MultiEdit)
    BEFORE=$(jq -r '[.tool_input.edits[]?.old_string] | join("\n")' \
      <<<"$INPUT" | count)
    AFTER=$(jq -r '[.tool_input.edits[]?.new_string] | join("\n")' \
      <<<"$INPUT" | count)
    ;;
  Write)
    if [[ -f "$FILE_PATH" ]]; then
      BEFORE=$(count <"$FILE_PATH")
    else
      BEFORE=0
    fi
    AFTER=$(jq -r '.tool_input.content // ""' <<<"$INPUT" | count)
    ;;
  *)
    exit 0
    ;;
esac

if ((AFTER > BEFORE)); then
  cat >&2 <<EOF
Blocked: this edit adds an ESLint suppression comment to $FILE_PATH.
AGENTS.md Mandatory Rule 6 forbids eslint-disable and /* eslint ... */
comments. Fix the code so the rule passes. If the rule is wrong for a whole
category of files, propose a scoped override in eslint.config.mjs, or ask the
owner.
EOF
  exit 2
fi

exit 0

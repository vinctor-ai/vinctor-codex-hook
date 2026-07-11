#!/usr/bin/env bash
# Offline MAPPING regression vectors for the Vinctor Codex hook.
#
# For each tool category, feeds a canonical event to the REAL hook CLI
# (`dist/src/cli.js explain --json`) and asserts the classification — i.e. the
# (action, resource) the hook WOULD send to /v1/enforce, or "abstain". This pins
# the MAPPING coverage column of docs/validation/coverage-probe/coverage-matrix.md
# so a classifier/defaults refactor that silently changes a mapping is caught.
#
# This is CLASSIFICATION ONLY. It is fully deterministic and offline — it does
# NOT measure whether Codex emits a PreToolUse event for any tool (that is RUNTIME
# coverage; see measure.sh). It never calls /v1/enforce (explain doesn't), and it
# prints only tool name + (action, resource) — never raw tool_input or grant_ref.
#
# Usage:  tools/codex-coverage/explain-matrix.sh
# Exit:   0 if every vector matches its expectation; 1 on any mismatch.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CLI="$REPO/dist/src/cli.js"

if [ ! -f "$CLI" ]; then
  echo "error: $CLI not found — run 'npm run build' first." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/explain-matrix.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail=0
pass=0

# check <label> <expected> <event-json>
#   expected: "action:resource" for a mapped call, or "abstain", or a decision
#   keyword like "parse_error" / "config_error".
check() {
  local label="$1" expected="$2" event="$3"
  printf '%s' "$event" > "$TMP/e.json"
  local out actual
  # explain exits 2 on parse_error / config_error but still writes valid JSON to
  # stdout, so capture stdout and ignore the exit code (don't append a fallback,
  # which would corrupt the captured JSON). `|| true` keeps `set -e` happy.
  out="$(node "$CLI" explain "$TMP/e.json" --json 2>/dev/null || true)"
  [ -n "$out" ] || out='{}'
  actual="$(node -e '
    let o={}; try{o=JSON.parse(process.argv[1])}catch{}
    if(o.decision==="mapped") process.stdout.write(o.action+":"+o.resource);
    else if(o.decision==="unmapped") process.stdout.write("abstain");
    else process.stdout.write(o.decision||"error");
  ' "$out")"
  if [ "$actual" = "$expected" ]; then
    printf '  ok   %-44s %s\n' "$label" "$actual"
    pass=$((pass + 1))
  else
    printf '  FAIL %-44s expected[%s] got[%s]\n' "$label" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

echo "Offline MAPPING regression vectors (classification only; no runtime emission)"
echo "hook: $(node "$CLI" --version 2>/dev/null || echo unknown)"
echo

# --- Bash: classifiers + defaults + abstain ---------------------------------
check "Bash npm publish"          "deploy:npm/package"   '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}'
check "Bash npm test (abstain)"   "abstain"              '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm test"}}'
check "Bash git push --force"     "execute:git/push-force" '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}'
check "Bash git status (abstain)" "abstain"              '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}'
check "Bash docker push"          "deploy:docker/image"  '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"docker push x"}}'
check "Bash cat .env (secret)"    "read:secret/env"      '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cat .env"}}'
check "Bash ls -la (abstain)"     "abstain"              '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls -la"}}'

# --- apply_patch: Add / Update / Delete / Move / multi / ordinary -----------
check "apply_patch Add package.json"     "write:repo/manifest/npm" '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Add File: package.json\n+{}\n*** End Patch"}}'
check "apply_patch Update .env"          "write:secret/env"        '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: config/.env\n+A=1\n*** End Patch"}}'
check "apply_patch Delete ci.yml"        "delete:ci/workflow"      '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Delete File: .github/workflows/ci.yml\n*** End Patch"}}'
check "apply_patch Move into .env"       "write:secret/env"        '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: config/.env\n+A=1\n*** End Patch"}}'
check "apply_patch multi (destructive)"  "delete:ci/workflow"      '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: package.json\n+x\n*** Delete File: .github/workflows/ci.yml\n*** End Patch"}}'
check "apply_patch ordinary (abstain)"   "abstain"                 '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: src/index.ts\n+x\n*** End Patch"}}'

# --- File tools (Claude-named; classification only) -------------------------
check "Read .env"            "read:secret/env"         '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":".env"}}'
check "Write package.json"   "write:repo/manifest/npm" '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"package.json"}}'
check "Edit ci.yml"          "write:ci/workflow"       '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":".github/workflows/ci.yml"}}'
check "MultiEdit id_rsa"     "write:secret/ssh"        '{"hook_event_name":"PreToolUse","tool_name":"MultiEdit","tool_input":{"file_path":"~/.ssh/id_rsa"}}'
check "Read ordinary (abstain)" "abstain"              '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"src/foo.ts"}}'

# --- Web (Claude-named; classification only) --------------------------------
check "WebFetch external"    "send:net/external/api.example.com" '{"hook_event_name":"PreToolUse","tool_name":"WebFetch","tool_input":{"url":"https://api.example.com/x"}}'
check "WebFetch internal"    "send:net/internal/127.0.0.1"       '{"hook_event_name":"PreToolUse","tool_name":"WebFetch","tool_input":{"url":"http://127.0.0.1/x"}}'
check "WebFetch bad url"     "parse_error"                       '{"hook_event_name":"PreToolUse","tool_name":"WebFetch","tool_input":{"url":"not a url"}}'
check "WebSearch (abstain)"  "abstain"                           '{"hook_event_name":"PreToolUse","tool_name":"WebSearch","tool_input":{"query":"vinctor"}}'

# --- MCP: built-in classifiers + abstain ------------------------------------
check "mcp filesystem read"  "read:fs/etc/passwd"                '{"hook_event_name":"PreToolUse","tool_name":"mcp__filesystem__read_file","tool_input":{"path":"/etc/passwd"}}'
check "mcp github issue"     "write:github/o/r/issue"            '{"hook_event_name":"PreToolUse","tool_name":"mcp__github__create_issue","tool_input":{"owner":"o","repo":"r","title":"t"}}'
check "mcp unknown (abstain)" "abstain"                          '{"hook_event_name":"PreToolUse","tool_name":"mcp__postgres__query","tool_input":{"sql":"select 1"}}'

echo
echo "vectors: $((pass + fail))  pass: $pass  fail: $fail"
[ "$fail" -eq 0 ] || { echo "REGRESSION: a mapping changed — update the matrix only if intended." >&2; exit 1; }
echo "all offline mapping vectors match the coverage matrix."

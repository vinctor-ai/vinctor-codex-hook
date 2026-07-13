#!/usr/bin/env bash
# Codex PreToolUse coverage-measurement harness.
#
# Answers, per tool category, three questions on a *pinned* Codex build:
#   1. emitted?   — does Codex fire a PreToolUse event for this tool at all?
#   2. mapped?    — does the hook classify the event (vs. abstain)?
#   3. action:resource — the (action, resource) the hook would send to /v1/enforce.
#
# emitted? is RUNTIME coverage and is version-dependent — it can only be answered
# by a real, authenticated Codex CLI (each probe costs API budget). mapped? and
# action:resource are MAPPING coverage and are answered OFFLINE by the real hook
# CLI (`explain --json`), so the lower two-thirds of the table is reproducible in
# any env. Keep the two columns separate: a tool the hook MAPS is not proof Codex
# EMITS the event for it.
#
# How it works:
#   * Wires tools/codex-coverage/log-wrapper.mjs as a catch-all PreToolUse hook in
#     a throwaway PROJECT-LOCAL .codex/ (so ~/.codex is never touched), and runs
#     directive `codex exec` probes in a sandboxed temp workspace. The wrapper
#     records ONLY the emitted tool_name (one JSON object per line) — never raw
#     tool_input, and the Codex PreToolUse event carries no grant_ref.
#   * For every tool category, runs the real hook CLI (dist/src/cli.js explain)
#     over a canonical event to record mapped? + action:resource — offline, no
#     /v1/enforce call.
#
# Usage:
#   tools/codex-coverage/measure.sh            # full run (needs codex CLI)
#   tools/codex-coverage/measure.sh --offline  # mapping columns only, no codex
#
# Output: a markdown coverage table on stdout + the raw emission log path. Paste
# the table into docs/validation/coverage-probe/coverage-matrix.md and commit it
# with the recorded Codex version.
#
# Discipline: measurement only. It does not change classifier / abstain / enforce
# behavior. It logs tool NAMES only (never tool_input / grant_ref).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WRAPPER="$HERE/log-wrapper.mjs"
CLI="$REPO/dist/src/cli.js"

OFFLINE=0
[ "${1:-}" = "--offline" ] && OFFLINE=1

if [ ! -f "$CLI" ]; then
  echo "error: $CLI not found — run 'npm run build' first." >&2
  exit 1
fi

WS="$(mktemp -d "${TMPDIR:-/tmp}/codex-cov.XXXXXX")"
LOG="$WS/emission.log"
EVENTS="$WS/events"
: > "$LOG"
mkdir -p "$WS/.codex" "$EVENTS"
git init -q "$WS"
cat > "$WS/.codex/hooks.json" <<JSON
{
  "hooks": {
    "PreToolUse": [
      { "matcher": ".*",
        "hooks": [{ "type": "command", "command": "node '$WRAPPER' '$LOG'" }] }
    ]
  }
}
JSON

CODEX_VERSION="unmeasured (no codex CLI)"
if command -v codex >/dev/null 2>&1; then
  CODEX_VERSION="$(codex --version 2>/dev/null || echo 'unknown')"
fi

echo "# Codex coverage measurement run" >&2
echo "codex: $CODEX_VERSION" >&2
echo "hook:  $(node "$CLI" --version 2>/dev/null || echo unknown)" >&2
echo "workspace: $WS" >&2
echo "emission log: $LOG" >&2
echo >&2

# --- Phase 1: drive Codex so it emits PreToolUse events (RUNTIME coverage) -----
# Each probe is a single, directive instruction so the agent uses exactly one tool
# category and stops. The wrapper allows every call, so the agent proceeds and we
# observe the real emitted tool_name. Skipped in --offline mode.
run_probe() {
  local label="$1" prompt="$2"
  echo ">>> probe: $label" >&2
  codex exec \
    --cd "$WS" \
    --sandbox workspace-write \
    --skip-git-repo-check \
    --dangerously-bypass-hook-trust \
    "$prompt" >"$WS/probe-$label.out" 2>&1 \
    || echo "   (codex exec exited non-zero; see $WS/probe-$label.out)" >&2
}

if [ "$OFFLINE" -eq 0 ] && command -v codex >/dev/null 2>&1; then
  run_probe bash         "Run exactly this shell command and then stop: echo coverage-probe-bash"
  run_probe applypatch_add    "Create a new file named probe.txt containing the single line: hello. Then stop."
  run_probe applypatch_update "Append the line 'world' to probe.txt. Then stop."
  run_probe applypatch_delete "Delete the file probe.txt. Then stop."
  run_probe applypatch_move   "Rename probe.txt to renamed.txt. Then stop."
  run_probe applypatch_multi  "In a single change, create two files alpha.txt and beta.txt, each containing the word x. Then stop."
  # Web / MCP / Claude-named file tools: only fire if the build/config has them.
  # They will simply produce no event if Codex does not emit them — that is the
  # measurement (emitted? = no). MCP needs a configured server; absent one this is
  # a no-op probe that records nothing, which is itself the answer.
  run_probe webfetch     "Fetch the URL https://example.com and summarize it in one line. Then stop."
  run_probe websearch    "Search the web for the phrase coverage-probe and report the top result title. Then stop."
else
  echo "(offline mode — skipping Codex probes; emission columns stay 'unmeasured')" >&2
fi
echo >&2

# Set of tool_names Codex actually emitted, derived from the wrapper log.
emitted_names() {
  [ -s "$LOG" ] || return 0
  node -e 'const fs=require("fs");const s=new Set();for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(!l.trim())continue;try{const n=JSON.parse(l).tool_name;if(typeof n==="string")s.add(n)}catch{}}process.stdout.write([...s].join("\n"))' "$LOG"
}
EMITTED="$(emitted_names || true)"

# Was the wrapper EVER invoked? Its invocation marker (written on every call by
# log-wrapper.mjs) is the load-confirmation control: present => hooks.json was
# loaded and the wrapper ran. Absent => either hooks.json was not loaded by this
# Codex build, OR Codex fired zero PreToolUse events. Either way the run cannot
# distinguish those, so an absent marker makes the whole run INCONCLUSIVE — an
# empty log must NEVER be rendered as a definitive "no".
wrapper_invoked() {
  # Any marker line at all (the marker is written even when tool_name is unparseable).
  [ -s "$LOG" ] && grep -q '"__wrapper_invoked__"' "$LOG"
}
WRAPPER_INVOKED=0
if wrapper_invoked; then WRAPPER_INVOKED=1; fi

# Alias-aware emission detection. Maps a logical tool to the set of names Codex
# might actually emit, so a real Codex shell emission (shell/exec/local_shell) is
# not mis-reported as "no" against the Claude name "Bash".
#
# SAFETY RULE: a logical tool with NO known Codex emission name (Read/Write/Edit/
# MultiEdit/WebFetch/WebSearch — Claude Code names with no native Codex equivalent;
# see src/types.ts CodexNativeTool = "Bash" | "apply_patch") can never yield a real
# yes/no from this harness: its absence resolves to "unmeasured", never a false
# "no". Only logical tools that ARE native Codex emission surfaces (the shell
# surface and apply_patch) or the mcp__ prefix may resolve an absence to "no".
emitted_cell() {
  # $1 = logical tool key (or the mcp__ prefix). Reports yes/no/unmeasured.
  local name="$1"
  if [ "$OFFLINE" -eq 1 ] || ! command -v codex >/dev/null 2>&1; then
    echo "unmeasured (no Codex runtime in this env)"; return
  fi
  # Load-confirmation gate: if the wrapper was never invoked, the run is
  # inconclusive — we cannot tell "hooks.json not loaded" from "Codex emitted
  # nothing", so no cell may become a bare "no".
  if [ "$WRAPPER_INVOKED" -eq 0 ]; then
    echo "unmeasured (hook wrapper never invoked — hooks.json likely not loaded by this Codex build, OR Codex emits no PreToolUse for these tools)"
    return
  fi
  # Wrapper WAS invoked, so an absent native-surface tool is a real "no".
  case "$name" in
    "mcp__")
      printf '%s' "$EMITTED" | grep -q '^mcp__' && echo "yes" || echo "no" ;;
    "Bash")
      # Codex's shell tool is named differently across builds; treat any alias as a match.
      printf '%s' "$EMITTED" | grep -qxE 'Bash|shell|exec|local_shell' && echo "yes" || echo "no" ;;
    "apply_patch")
      printf '%s' "$EMITTED" | grep -qx "apply_patch" && echo "yes" || echo "no" ;;
    *)
      # Logical tool with no known Codex emission name (Read/Write/Edit/MultiEdit/
      # WebFetch/WebSearch). Absence is NOT evidence of "no" — Codex may simply
      # never emit under this name. If it happened to appear, report yes; else
      # stay unmeasured (never a false "no").
      printf '%s' "$EMITTED" | grep -qx "$name" && echo "yes" || echo "unmeasured (no known Codex emission name for this tool)" ;;
  esac
}

# --- Phase 2: offline mapping + enforce action:resource (MAPPING coverage) -----
# Run the REAL hook CLI over a canonical event for each tool category. `explain`
# never calls /v1/enforce; it reports the (action, resource) the hook WOULD send.
write_event() { printf '%s' "$2" > "$EVENTS/$1.json"; }

# Canonical events per category. apply_patch envelopes use the real Codex
# `*** Begin Patch` shape and the current `command` field name (see
# src/apply-patch.ts). The parser retains `input`/`patch` compatibility.
write_event bash          '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}'
write_event bash_abstain  '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm test"}}'
write_event ap_add        '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Add File: package.json\n+{}\n*** End Patch"}}'
write_event ap_update     '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: config/.env\n+A=1\n*** End Patch"}}'
write_event ap_delete     '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Delete File: .github/workflows/ci.yml\n*** End Patch"}}'
write_event ap_move       '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: config/.env\n+A=1\n*** End Patch"}}'
write_event ap_multi      '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: package.json\n+x\n*** Delete File: .github/workflows/ci.yml\n*** End Patch"}}'
write_event ap_ordinary   '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: src/index.ts\n+x\n*** End Patch"}}'
write_event read          '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":".env"}}'
write_event write         '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"package.json"}}'
write_event edit          '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":".github/workflows/ci.yml"}}'
write_event multiedit     '{"hook_event_name":"PreToolUse","tool_name":"MultiEdit","tool_input":{"file_path":"~/.ssh/id_rsa"}}'
write_event webfetch      '{"hook_event_name":"PreToolUse","tool_name":"WebFetch","tool_input":{"url":"https://api.example.com/x"}}'
write_event websearch     '{"hook_event_name":"PreToolUse","tool_name":"WebSearch","tool_input":{"query":"vinctor"}}'
write_event mcp_fs        '{"hook_event_name":"PreToolUse","tool_name":"mcp__filesystem__read_file","tool_input":{"path":"/etc/passwd"}}'
write_event mcp_gh        '{"hook_event_name":"PreToolUse","tool_name":"mcp__github__create_issue","tool_input":{"owner":"o","repo":"r","title":"t"}}'

# explain a category → "mapped: action:resource" | "abstain" | "<status>".
# Reads ONLY emitted name + (action, resource) — no raw tool_input is printed.
explain_cell() {
  local key="$1"
  local out
  out="$(node "$CLI" explain "$EVENTS/$key.json" --json 2>/dev/null || echo '{}')"
  node -e '
    let o={}; try{o=JSON.parse(process.argv[1])}catch{}
    if(o.decision==="mapped") process.stdout.write("mapped: "+o.action+":"+o.resource);
    else if(o.decision==="unmapped") process.stdout.write("abstain");
    else process.stdout.write(o.decision||"error");
  ' "$out"
}

# --- Emit the coverage table -------------------------------------------------
emit_row() { # name | runtime-emitted | mapping-cell-key
  printf '| `%s` | %s | %s |\n' "$1" "$(emitted_cell "$2")" "$(explain_cell "$3")"
}

cat <<MD
<!-- generated by tools/codex-coverage/measure.sh — do not hand-edit the cells -->
Codex build: $CODEX_VERSION
Hook version: $(node "$CLI" --version 2>/dev/null || echo unknown)

| Tool / category | emitted? (RUNTIME) | mapped? + action:resource (MAPPING, offline) |
|---|---|---|
MD
emit_row "Bash (npm publish)"            "Bash"        bash
emit_row "Bash (npm test, abstain)"      "Bash"        bash_abstain
emit_row "apply_patch Add"               "apply_patch" ap_add
emit_row "apply_patch Update"            "apply_patch" ap_update
emit_row "apply_patch Delete"            "apply_patch" ap_delete
emit_row "apply_patch Move (rename)"     "apply_patch" ap_move
emit_row "apply_patch multi-file"        "apply_patch" ap_multi
emit_row "apply_patch ordinary (abstain)" "apply_patch" ap_ordinary
emit_row "Read"                          "Read"        read
emit_row "Write"                         "Write"       write
emit_row "Edit"                          "Edit"        edit
emit_row "MultiEdit"                     "MultiEdit"   multiedit
emit_row "WebFetch"                      "WebFetch"    webfetch
emit_row "WebSearch"                     "WebSearch"   websearch
emit_row "mcp__filesystem__read_file"    "mcp__"       mcp_fs
emit_row "mcp__github__create_issue"     "mcp__"       mcp_gh

echo >&2
echo "raw emission log retained at: $LOG" >&2
echo "(contains tool_name + hook_event_name only — no tool_input / grant_ref)" >&2

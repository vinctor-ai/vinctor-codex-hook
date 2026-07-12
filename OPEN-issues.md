# Open Issues — vinctor-codex-hook
Living tracker so already-fixed items are not re-worked. Re-verify before re-routing.

## Open
- MCP `PreToolUse` runtime traversal remains unmeasured on a configured real MCP server.
- Broader `unified_exec`, WebSearch, and other non-shell/non-MCP paths remain outside complete interception by Codex hooks.

## Recently resolved — do NOT re-route
- Real Codex runtime measurement: trusted plugins received `Bash` on 0.137.0,
  0.139.0, and 0.144.1. Codex 0.144.1 also emitted `apply_patch` with its
  envelope in `tool_input.command`; a protected-path patch was classified and
  blocked before execution.
- Harness disambiguation (this PR): empty/un-loaded log no longer reported as a false "no"; emitted detection is now name-agnostic for the shell surface (Bash|shell|exec|local_shell) and prefers "unmeasured" over a false "no" when the Codex emission name is unknown.

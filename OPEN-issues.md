# Open Issues — vinctor-codex-hook
Living tracker so already-fixed items are not re-worked. Re-verify before re-routing.

## Open
- Codex PreToolUse firing on a pinned real Codex build is still UNMEASURED/INCONCLUSIVE. Run the disambiguated harness (tools/codex-coverage/measure.sh) against a real pinned codex-cli; keep coverage-matrix emitted? cells "unmeasured" until the wrapper is confirmed invoked.

## Recently resolved — do NOT re-route
- Harness disambiguation (this PR): empty/un-loaded log no longer reported as a false "no"; emitted detection is now name-agnostic for the shell surface (Bash|shell|exec|local_shell) and prefers "unmeasured" over a false "no" when the Codex emission name is unknown.

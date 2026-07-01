# Vinctor Codex CLI Hook — v0.1.0 Design

**Status:** Boundary Preview
**Date:** 2026-06-10
**Reference implementation:** `vinctor-claude-code-hook` (v0.3.0)

> **Update (parity iteration, 2026-06-10):** §1's "What changes" table originally
> *omitted* `WebFetch`/`WebSearch`/`Read`·`Write`·`Edit`·`MultiEdit`. That decision
> was reversed: the hook now implements the **full superset** of claude-hook's tool
> surfaces (so it can classify them if a runtime emits them, and to pass the ported
> claude-hook test suite), while documenting honestly that Codex firing
> `PreToolUse` for web/file/MCP tools is version-dependent and not guaranteed. The
> `ask`→abstain semantics, `apply_patch`, `model`/`turn_id` input, config
> filename/env, and non-disclosure invariants are unchanged. See the README Tool
> Coverage table + caveat for the current, accurate surface.

This spec records the design of the Codex CLI hook boundary. It is the Codex
counterpart to the Claude Code hook: same product role (translate a tool call
into `(action, resource)` and ask the Vinctor authorization service), adapted to
Codex CLI's actual hook contract.

---

## 1. Codex CLI hook contract (researched, primary-source verified)

Source: <https://developers.openai.com/codex/hooks> (verified 2026-06-10).

Codex CLI gained lifecycle hooks (GA 2026-05-14) that deliberately mirror Claude
Code's hook shape. The relevant event is **`PreToolUse`** — it fires before a tool
call executes and can block it.

- **Transport:** one JSON object on **stdin**; the hook writes its decision as a
  JSON object on **stdout**. Exit code `2` (with a reason on stderr) is an
  alternative "block" signal.
- **Input fields:** `session_id`, `transcript_path`, `cwd`, `hook_event_name`
  (`"PreToolUse"`), `model`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`
  (a JSON value), `permission_mode`.
- **Output envelope** (identical field names to Claude Code):
  ```json
  { "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "..." } }
  ```
- **`permissionDecision` values:** only **`allow`** and **`deny`** are honored.
  **`ask` is parsed but NOT supported** — using it marks the hook run as failed.
- **Empty stdout + exit 0** = success; the call proceeds to Codex's own
  `approval_policy` / `sandbox_mode` flow (i.e. the user's native approval).
- **Tool names:** shell execution is `Bash`; file edits are `apply_patch`
  (matcher also accepts `Edit`/`Write`, but `tool_name` is always `apply_patch`);
  MCP tools are `mcp__<server>__<tool>`. There is **no** `Read`/`WebFetch`/
  `WebSearch` tool surface.
- **Coverage caveat:** the hook reliably fires for `Bash`. `apply_patch` and most
  MCP tool calls have historically been unreliable (openai/codex#16732, #17794).
  Codex's own docs call PreToolUse "a guardrail rather than a complete enforcement
  boundary." We document this honestly and do not claim universal interception.

### What carries over from the Claude hook unchanged

`enforce-client` (`/v1/enforce` strict body, `X-Agent-Key`), `errors`,
`mcp-name`, the mapping/specificity engine, the Bash classifiers
(`git`/`npm`/`docker`/`gh`/secret-reader), the MCP classifiers
(`filesystem`/`github`/`slack`), `sensitive-paths`, the config loader/validator
shape, and the `validate`/`explain` subcommands.

### What changes for Codex

| Concern | Claude Code hook | Codex hook |
|---|---|---|
| Unmapped call | returns `ask` | **abstains: empty stdout + exit 0** (defers to Codex's native approval) |
| Decision enum | `allow`/`deny`/`ask` | `allow`/`deny` only |
| Input fields | no `model`/`turn_id` | adds `model`, `turn_id` |
| File tools | `Read`/`Write`/`Edit`/`MultiEdit` (by `file_path`) | `apply_patch` (parse patch envelope for target paths) |
| Web tools | `WebFetch`/`WebSearch` | none (omitted — no such hook tool) |
| Config path | `.vinctor/claude-code-hook.json` | `.vinctor/codex-hook.json` |
| Env override | `VINCTOR_CLAUDE_CODE_HOOK_CONFIG` | `VINCTOR_CODEX_HOOK_CONFIG` |

---

## 2. Decision semantics

The hook has **three** outcomes:

1. **Mapped + service permit** → `permissionDecision: "allow"`.
2. **Mapped + fail-closed** (service deny, unreachable, timeout, malformed input,
   invalid config, missing auth env) → `permissionDecision: "deny"` with a
   fixed-template reason.
3. **Unmapped** (no config rule / built-in classifies the call) → **abstain**:
   the hook emits **no stdout** and exits 0, deferring to Codex's native approval
   flow. This is the Codex equivalent of the Claude hook's `ask`, because Codex
   does not support `ask`.

`deny` is never used for "we couldn't classify it" — only for fail-closed on a
*mapped* call (or malformed input). Returning `allow` for an unclassifiable call
would be an authorization claim the hook cannot back; returning `deny` would put
every unrecognized call outside the user's normal flow. Abstaining is the only
choice consistent with "only classified calls reach the service; everything else
defers to the user."

---

## 3. Tool surfaces

### `Bash`
Identical to the Claude hook. `tool_input.command` → normalized command →
config rules → classifier (`git`/`npm`/`docker`/`gh`/secret-reader) → Bash
pattern defaults (secrets-read, release-publish, infra-ops, exfiltration). No
match → abstain.

### `apply_patch`
`tool_input.input` (fallback `tool_input.patch`) holds the patch envelope text:
```
*** Begin Patch
*** Add File: path/a
+...
*** Update File: path/b
*** Move to: path/c
@@ ...
*** Delete File: path/d
*** End Patch
```
The parser extracts one op per `*** {Add|Update|Delete} File:` line, deriving the
action: `Add`/`Update` → `write`, `Delete` → `delete`. A `*** Move to:` line
retargets the preceding `Update` op's destination path (still `write`).

Mapping over the ops:
- **Config layer:** operator rules with `tool: "apply_patch"` match `pattern`
  against each op's normalized path (`matchType` = `exact`/`prefix`/`glob`). The
  rule's explicit `action`/`resource` win. Among matches, most-specific rule wins.
- **Built-in layer** (only if no config match): each op path is classified —
  sensitive paths → `secret/<kind>` (shared `sensitive-paths`); protected paths
  (`**/.github/workflows/*.yml`, `**/package.json`, `**/Dockerfile*`, `**/*.tf`,
  `**/k8s/**`) → their resource. The op's own action is used.
- **Winner across ops:** prefer the most destructive (`delete` > `write`), then
  the most specific resource. One `/v1/enforce` call per the v1 contract.
- No op matches → abstain (ordinary file edits defer to the user).

**Documented limitation:** when one patch touches several in-boundary paths, only
the single highest-risk match is enforced this preview; other paths in the same
patch are not separately checked.

### `mcp__<server>__<tool>`
Identical to the Claude hook. Config rules (with optional `inputField`) →
built-in classifiers (`filesystem`/`github`/`slack`). Unrecognized → abstain.

---

## 4. `/v1/enforce` contract (unchanged, not extended)

Body is strictly `{ grant_ref, action, resource }`; header `X-Agent-Key`.
`grant_ref` from `VINCTOR_GRANT_REF`, key from `VINCTOR_AGENT_KEY`, endpoint from
`VINCTOR_ENDPOINT`. 200 → permit; 403 → `action_denied`; anything else / network
error / timeout (500 ms) → `service_unavailable`. Fail-closed.

---

## 5. Non-disclosure invariants (ratchet tests)

`permissionDecisionReason` is always a fixed template. It never contains:
`grant_ref` (`grt_`), `audit_event_id`, raw tool input (command / patch text /
file path / MCP field values), or the mapped scope. Enforced by regression tests
over every output factory and the full decision matrix (permit / service-deny /
service-unavailable / missing-auth / malformed), for every tool surface.

---

## 6. Non-claims (README/docs must preserve)

Not an official Codex plugin/integration. Not a sandbox. Not raw shell/tool
interception. Not a hosted service. Not production-ready. Does not issue grants.
Applies only to configured Codex hook paths (and even then, only where Codex
reliably fires the hook). Status label: **Boundary Preview**.

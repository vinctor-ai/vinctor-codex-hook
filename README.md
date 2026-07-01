# Vinctor Codex CLI Hook

> **Status:** Boundary Preview

[![CI](https://github.com/vinctor-ai/vinctor-codex-hook/actions/workflows/ci.yml/badge.svg)](https://github.com/vinctor-ai/vinctor-codex-hook/actions/workflows/ci.yml)

A Codex CLI `PreToolUse` hook that routes tool calls through runtime authorization
before execution.

## Why This Exists

AI agents are no longer just generating text. Across agent systems, they are
increasingly executing tools — running shell commands, editing files, calling
third-party services, triggering deployments, and reaching into systems that hold
sensitive data. The surface area of "what an agent can touch" is expanding faster
than the surface area of "what an agent has been explicitly authorized to do."

Static credentials and prompt-level safety guidelines do not cover this gap. An
agent's allowed scope depends on the task, the operator, the target resource, and
the moment. It changes during a session, can be revoked mid-run, and must be
evaluated against operator-defined policy — not against the agent's own reasoning.

A runtime authorization boundary — one that decides, per tool call, whether a
specific agent may perform a specific action on a specific resource right now —
narrows that gap by making selected tool calls subject to an authorization
decision before execution. This repository implements that boundary for Codex CLI.

## What This Repository Contains

This repo holds the **runtime boundary** that selected Codex CLI tool calls pass
through before they execute. It is one piece of the broader Vinctor runtime
authorization infrastructure. The authorization service itself — grant model,
policy evaluation, audit log, revocation — lives separately.

The hook does two things, in this order:

1. **Asks the authorization service for a decision.** When Codex is about to
   invoke a configured tool, it runs the hook for the `PreToolUse` event, the hook
   maps the tool input to an `(action, resource)` pair, and then calls the
   authorization service for a permit-or-deny decision dynamically.

2. **Acts on the decision.**
   - Service permit → the hook returns `allow` and Codex proceeds.
   - Service deny, unreachable, timeout, malformed input, missing required env →
     the hook **fails closed** and returns `deny` with a fixed-template reason.
   - Tool call cannot be classified by config or built-in defaults → the hook
     **abstains** (emits no decision), deferring to Codex's own approval/sandbox
     flow.

   The hook does not include the underlying grant reference, audit event id, or
   matched scope in any reason string.

```
Codex CLI (PreToolUse event)
        │
        ▼
   This hook ── maps → asks the authorization service
        │                          │
        │                  permit / deny / fail-closed
        ▼                          │
   allow / deny  ◀──────────────────
        │   (or, if unclassifiable: emit nothing → Codex's native approval flow)
        ▼
Codex CLI (executes tool, or blocks)
```

### Why "abstain" instead of "ask"

Claude Code's hook contract supports an `ask` decision; Codex's does not — its
`permissionDecision: "ask"` is documented as "parsed but not supported yet," and
using it fails the hook run. So when a tool call can't be classified, this hook
emits **nothing** and exits 0, which Codex treats as "proceed to the normal
approval flow." That is the Codex-native equivalent of deferring to the user.

## Tool Coverage

**Built-in defaults cover selected high-impact command families and file edits.
They are not a complete catalog.** A call the built-ins don't recognize causes the
hook to abstain (Codex's native approval applies) unless the operator maps it in
config. For example, `npm publish` / `git push --force` / `docker push` are mapped,
but `npm test`, `npm install`, `git status`, and `git commit` are not. Use
`vinctor-codex-hook explain <event>` to see exactly how any single call maps.

| Tool | Coverage | Default behavior |
|---|---|---|
| `Bash` | high-impact subset | classifier-aware for a selected subset of `git` / `npm`·`pnpm`·`yarn` / `docker` / `gh` (force-push, publish, image push, release create), plus pattern defaults (secrets-read, release, infra, exfiltration). Everything else → abstain. |
| `apply_patch` | secret + protected paths | the patch is parsed for its target file paths; editing/deleting `.env`, SSH keys, cloud-credential files → `write`/`delete:secret/<kind>`, and CI workflows / `package.json` / Dockerfiles / Terraform / k8s manifests → their protected resource. Ordinary file edits → abstain. |
| `Read` / `Write` / `Edit` / `MultiEdit` † | secret + protected paths | by `file_path`: reading **and** writing `.env`, SSH keys, and cloud-credential files is in-boundary (`read`/`write:secret/<kind>`); writing CI workflows / `package.json` / Dockerfiles / Terraform / k8s manifests is `write:<resource>`. Ordinary files → abstain. |
| `WebFetch` † | full *(classification)* | every fetch maps to `send:net/internal/<host>` or `send:net/external/<host>`. Operator config can override per host. |
| `WebSearch` † | matcher only | no built-in mapping; operator config required, otherwise abstain. |
| `mcp__<server>__<tool>` | built-in classifiers for `filesystem`, `github`, `slack`; other servers: matcher only | These three servers' common tools are mapped out of the box. Tools they don't recognize, and all other MCP servers, require operator config — otherwise abstain. |

> **† Codex hook-firing caveat — this matters.** The table above describes what the
> hook *classifies* if it receives the event. It does **not** assert that Codex
> fires `PreToolUse` for every one of these tools. Codex's own docs call
> `PreToolUse` "a guardrail rather than a complete enforcement boundary": it fires
> reliably for `Bash`, while `apply_patch` and most MCP tool calls have been
> unreliable on some Codex builds (openai/codex#16732, #17794), and `Read` /
> `Write` / `Edit` / `MultiEdit` / `WebFetch` / `WebSearch` are **Claude Code tool
> names** — whether your Codex build emits a hook event under those names is
> version-dependent and not guaranteed. They are supported here so the boundary is
> ready if/when the runtime surfaces them (and for non-Codex runtimes that reuse
> this binary), not because Codex is promised to fire them. This hook cannot make
> Codex fire a hook it doesn't fire. Verify on your installed version. This is not
> raw interception.
>
> To measure *your* build: a reproducible harness lives in
> [`tools/codex-coverage/`](tools/codex-coverage/), and the per-tool coverage
> matrix (RUNTIME `emitted?` vs. MAPPING `action:resource`) plus a runbook is in
> [`docs/validation/coverage-probe/coverage-matrix.md`](docs/validation/coverage-probe/coverage-matrix.md).
> Every RUNTIME cell there is `unmeasured` until run against a real Codex build.

## What This Is Not

Vinctor authorizes configured, mediated tool calls routed through an adapter
boundary. Unwrapped tool paths remain outside Vinctor's boundary. Vinctor does not
provide OS/process/account isolation, sandboxing, raw tool interception, provider
credential control, or rollback of already-started work.

This repository is **not an official Codex plugin or integration.** It is a Codex
CLI `PreToolUse` hook boundary for the Vinctor authorization service. It applies
only to the Codex hook paths you configure, and only where Codex fires the hook.

## Install (Boundary Preview)

**Before starting**, have these ready:

- **Codex CLI** installed (this is a Codex CLI hook).
- A **running Vinctor authorization service endpoint** to point `VINCTOR_ENDPOINT`
  at — the hook asks it for every decision and does not run it for you.
- A **valid agent grant**: an agent key (`aak_…`) and a grant reference (`grt_…`)
  issued for your agent. Without them the hook fails closed (you can still
  evaluate mapping/abstain offline — see [below](#getting-a-grant-and-evaluating-offline)).

```bash
git clone <repo>
cd vinctor-codex-hook
npm install
npm run build
```

Wire the built CLI into Codex's hook config (`~/.codex/hooks.json` or
`.codex/hooks.json`, or the equivalent `[[hooks.PreToolUse]]` tables in
`config.toml`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|apply_patch|Edit|Write|Read|MultiEdit|WebFetch|WebSearch|mcp__.*",
        "hooks": [{ "type": "command", "command": "<absolute path>/dist/src/cli.js" }]
      }
    ]
  }
}
```

> [!IMPORTANT]
> Codex's hook-loading mechanism is version-dependent. A real measurement run against codex-cli 0.137.0 found that recent builds load hooks through the **plugin system**, and a project-local `.codex/hooks.json` does **not** load on 0.137.0. The `hooks.json` / `config.toml` wiring shown here reflects builds that read hook config directly — verify it actually loads on your Codex version. Runtime hook firing on 0.137.0 is currently **unmeasured/inconclusive** (see `docs/validation/coverage-probe/coverage-matrix.md`).

> **Keep the matcher scoped to the tool names above.** A tool call whose
> `tool_name` the hook doesn't recognize is treated as malformed input and
> **denied** (fail-closed) — so a broad matcher like `.*` would block every
> unrecognized or future Codex tool, not defer it. Match only the tools listed.

Required env in the Codex session:

- `VINCTOR_ENDPOINT` — base URL of the Vinctor authorization service
- `VINCTOR_AGENT_KEY` — agent API key (`aak_…`)
- `VINCTOR_GRANT_REF` — opaque grant reference (`grt_…`)

Optional:

- `VINCTOR_BOUNDARY_ID` — optional boundary id from the local Vinctor service.
  When set, the hook sends it as `X-Vinctor-Boundary-Id` so service audit rows
  can record which configured runtime boundary made the enforce call.
- `VINCTOR_CODEX_HOOK_CONFIG` overrides the default config path
  `.vinctor/codex-hook.json`.
- `VINCTOR_HOOK_DEBUG=1` makes hook mode write one diagnostic line to **stderr**
  per event, naming the resolved config path and whether it was found. It never
  touches stdout (the hook decision) and never echoes secret env values. Leave it
  unset in normal use.

This is a Boundary Preview. Not production-ready. Not an official Codex plugin.
Not yet published as a public npm package.

## Getting a grant, and evaluating offline

Real permit/deny decisions require a **running Vinctor authorization service** and
a **grant** issued for your agent. The hook itself does not run that service and
does not issue grants — it only classifies a tool call and asks the service.

- `VINCTOR_ENDPOINT`, `VINCTOR_AGENT_KEY` (`aak_…`), `VINCTOR_GRANT_REF`
  (`grt_…`), and optional `VINCTOR_BOUNDARY_ID` come from the Vinctor
  authorization service or local evaluation setup, not from this repo.
- There is no public Vinctor service yet.
- Without those env vars you can still evaluate the hook **offline**, because its
  decision is observable without ever reaching the service:
  - A **mapped** call with missing/incomplete auth env returns
    `deny: missing_auth_env` — the success signal that the hook classified the call
    and *would* have asked the service.
  - An **unmapped** call emits nothing (abstain) — the hook could not classify it
    and defers to Codex.
  - A mapped call whose service is unreachable returns `deny: service_unavailable`
    — the hook fails closed.

So offline you can fully validate mapping, abstain, `missing_auth_env`, and
fail-closed behavior; only the live `allow` / `deny: action_denied` outcomes need a
running service with a valid grant.

## Quickstart (end to end)

```bash
# 1. Build
git clone <repo> && cd vinctor-codex-hook && npm install && npm run build

# 2. (optional) Write an operator policy
mkdir -p .vinctor
cat > .vinctor/codex-hook.json <<'JSON'
{ "version": 1, "rules": [
  { "tool": "apply_patch", "matchType": "glob", "pattern": "**/migrations/**",
    "action": "deploy", "resource": "db/migration" }
] }
JSON

# 3. Validate the policy (offline; exit 0 valid, 1 invalid, 2 unreadable)
node dist/src/cli.js validate .vinctor/codex-hook.json

# 4. See how a specific call would map (offline; no service call)
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}' > /tmp/e.json
node dist/src/cli.js explain /tmp/e.json --json   # → mapped deploy:npm/package

# 5. Run one event through the hook itself (no auth env → fails closed at the boundary)
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}' \
  | node dist/src/cli.js          # → deny: missing_auth_env  (mapped, would ask the service)
```

Then wire the built CLI into Codex's hook config (above) and, once you have a
service endpoint + grant, set the three `VINCTOR_*` env vars in the session. With
those set, step 5's `npm publish` becomes a real `allow` or `deny: action_denied`
from the service. Expected decisions at a glance: a mapped call in the grant →
`allow`; mapped but not in the grant → `deny`; unmapped → abstain (Codex decides);
service down or env missing → `deny` (fail-closed).

## Configuration

Operator policy lives in an optional JSON file at `.vinctor/codex-hook.json`
(override the path with `VINCTOR_CODEX_HOOK_CONFIG`). It adds or overrides mappings
from a Codex tool call to an `(action, resource)` pair. The file is optional —
without it, the hook uses only its built-in mappings.

```json
{
  "version": 1,
  "rules": [
    { "tool": "Bash", "matchType": "prefix", "pattern": "terraform destroy",
      "action": "delete", "resource": "infra/terraform/destroy" },
    { "tool": "apply_patch", "matchType": "glob", "pattern": "**/secrets/**",
      "action": "write", "resource": "secret/custom" },
    { "tool": "mcp__filesystem__read_file", "matchType": "glob", "pattern": "**/etc/**",
      "inputField": "path", "action": "read", "resource": "secret/etc" }
  ]
}
```

Each rule has: `tool` (`Bash`, `apply_patch`, or `mcp__<server>__<tool>`),
`matchType` (`exact` / `prefix` / `glob`), `pattern`, `action` (one of
`read`/`write`/`execute`/`deploy`/`delete`/`send`), and `resource`. Operator rules
always take precedence over built-in mappings; the most specific matching rule
wins. A call that matches nothing causes the hook to abstain.

Full reference — every field, the per-tool "what `pattern` matches against" table,
apply_patch path semantics, glob/specificity rules, MCP `inputField`, and worked
examples — is in [docs/configuration.md](docs/configuration.md).

## Inspecting output

The hook writes a single-line JSON decision on stdout (so Codex can parse it), or
nothing at all when it abstains. To read a decision by hand, pipe through `jq`, and
use `--version` / `--help` to check the binary without sending an event:

```bash
node dist/src/cli.js --version
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}' \
  | node dist/src/cli.js | jq
```

### Checking a config or a tool call offline

```bash
# Lint a config file (every error at once); exit 0 valid, 1 invalid, 2 unreadable
node dist/src/cli.js validate .vinctor/codex-hook.json --json

# Show how an event would map (action, resource, which rule won); no service call
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}' > /tmp/e.json
node dist/src/cli.js explain /tmp/e.json --json
```

`--json` prints a structured object (intended for agents); omit it for
human-readable text. `explain` never calls `/v1/enforce`.

For what each decision and deny code means — and where to look when a permit you
expected comes back denied — see [docs/troubleshooting.md](docs/troubleshooting.md).

## Status

**Boundary Preview.** Interfaces, configuration shape, and supported tool coverage
may change before a stable release. Not production-ready.

## Audience

Developers and design partners evaluating runtime authorization boundaries for
Codex CLI tool execution.

## License

MIT

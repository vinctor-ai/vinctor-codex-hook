# Codex PreToolUse coverage matrix

> Per-tool coverage of the Vinctor Codex hook, split into two independent kinds.
> Generated/refreshed by [`tools/codex-coverage/measure.sh`](../../../tools/codex-coverage/measure.sh).

## CONTEXT — why this doc exists

The hook can **classify** every tool surface (proven by the headless dogfood and
the service-backed E2E). What is **not** proven is whether a real Codex build
actually **emits** a `PreToolUse` event for each tool — Codex docs call
`PreToolUse` "a guardrail rather than a complete enforcement boundary,"
`apply_patch`/MCP firing has been unreliable on some builds (openai/codex#16732,
#17794), and `Read`/`Write`/`Edit`/`MultiEdit`/`WebFetch`/`WebSearch` are Claude
Code tool names Codex may never emit. This matrix separates those two questions so
neither is over-claimed.

Two coverage kinds — **do not conflate them:**

- **RUNTIME coverage — `emitted?`** Does Codex fire `PreToolUse` for this tool on
  this build? Version-dependent; only a real, authenticated Codex CLI can answer
  it. Bash and `apply_patch` are now measured on the builds recorded below;
  unsupported or unexercised surfaces remain `unmeasured`.
- **MAPPING coverage — `mapped?` + `action:resource`** Given the event, does the
  hook classify it, and to what `(action, resource)`? Deterministic; measured
  **offline** by the real hook CLI (`explain --json`). These cells are filled.

A mapped tool is **not** proof Codex emits the event for it. `emitted?` is the
only column that proves the boundary is actually reachable on a given build.

## WHAT THIS CHANGE DOES — current state

- The MAPPING columns are filled from the real CLI (`vinctor-codex-hook` 0.1.0),
  offline. No `/v1/enforce` call is made.
- Trusted plugin runs measured `Bash` on Codex 0.137.0, 0.139.0, and 0.144.1,
  and `apply_patch` on 0.144.1. A protected `package.json` patch arrived in
  `tool_input.command`, mapped to `write:repo/manifest/npm`, and was denied
  before the file was created.

### Harness disambiguation fixes (measurement instrument only)

The harness was hardened so a future real-build run cannot produce a false
negative. **No `emitted?` cell was flipped to a finding by this change** — they
remain `unmeasured`. Two fixes:

1. **Load-confirmation control.** `tools/codex-coverage/log-wrapper.mjs` now writes
   an `__wrapper_invoked__` marker on *every* invocation (even when `tool_name` is
   unparseable). `measure.sh` reads it as a control: if the wrapper was **never**
   invoked, the whole run is inconclusive and every `emitted?` cell is reported
   `unmeasured (hook wrapper never invoked — hooks.json likely not loaded by this
   Codex build, OR Codex emits no PreToolUse for these tools)`. An empty/un-loaded
   log is **never** rendered as a bare `no`. A specific tool may be reported `no`
   **only** after the wrapper is demonstrably invoked at least once.
2. **Name-agnostic, safety-biased emission detection.** Codex's shell tool is
   named differently across builds, so the `Bash` row now matches any of
   `Bash|shell|exec|local_shell`. For logical tools with **no** known Codex
   emission name (`Read`/`Write`/`Edit`/`MultiEdit`/`WebFetch`/`WebSearch` —
   Claude Code names; `src/types.ts` defines `CodexNativeTool = "Bash" |
   "apply_patch"`), an absence resolves to `unmeasured`, **never** a false `no`.
   Only native emission surfaces (the shell surface, `apply_patch`) and the
   `mcp__` prefix can yield a real `no`.

The harness remains useful for version-by-version measurement. Unexercised
surfaces stay `unmeasured`; observed surfaces are recorded below.

## Measurement runs (dated)

### 2026-07-11 — Codex 0.137.0, 0.139.0, and 0.144.1: plugin `PreToolUse` observed

A trusted local plugin running the real Vinctor CLI received
`{ "hook_event_name": "PreToolUse", "tool_name": "Bash" }` on all three builds.
With `npm publish` mapped and the Vinctor auth env intentionally absent, the
hook returned `deny:missing_auth_env` and Codex blocked the command before
execution. Codex 0.144.1 also confirmed that an empty-output hook completes and
continues the command, while a bare `permissionDecision:"allow"` is reported as
a failed hook. The adapter now uses empty stdout for service permits.

On Codex 0.144.1, the same trusted plugin also received `tool_name:
"apply_patch"` with the patch envelope in `tool_input.command`. Before the wire
field fix the hook denied it as `malformed_payload`; after the fix it mapped a
`package.json` Add patch, returned the expected fail-closed `missing_auth_env`
deny, and Codex did not create the file. A second run against the shared mock
service permitted `write:repo/manifest/npm`; the hook completed with empty stdout
and Codex created the requested file with the exact contents.

### 2026-06-21 — codex-cli 0.137.0 (model gpt-5.5, macOS): `emitted?` still `unmeasured` via BOTH paths

A real, authenticated Codex was driven on this build through both hook-loading
mechanisms. Neither invoked the wrapper, so no `emitted?` cell can be resolved.

- **Path A — project-local `.codex/hooks.json`** (this harness, `measure.sh`):
  the wrapper was **never invoked**. The load-confirmation control worked as
  designed — every cell was reported `unmeasured (hook wrapper never invoked …)`,
  never a false `no`. Consistent with 0.137.0 not loading a project-local
  `.codex/hooks.json`.
- **Path B — the plugin system** (isolated `CODEX_HOME`, so the real `~/.codex`
  was untouched): a valid local marketplace plus a minimal plugin carrying a
  `PreToolUse` hook (`matcher: ".*"`) was installed, **enabled**
  (`config.toml [plugins."…"] enabled = true`), and materialized into the active
  plugin dir (`$CODEX_HOME/.tmp/plugins/plugins/<name>`). Driven with
  `codex exec … --dangerously-bypass-hook-trust`, the **shell tool ran** but the
  **hook never fired**; at `RUST_LOG=codex_core_plugins=debug,codex_core_hooks=debug`
  there were **zero** hook load/register/execute lines.

**Superseded conclusion:** this run concluded that 0.137.0 `codex exec` did not load or run plugin
`PreToolUse` hooks at all — through neither the `hooks.json` nor the plugin path.
Hook firing appears limited to the interactive TUI, which this environment cannot
drive headlessly. The `emitted?` cells therefore remain `unmeasured`; the README
firing caveat is, if anything, understated.

## Coverage table

> RUNTIME cells: replace with `yes` / `no` only after running the runbook on a
> real build, and record the version below. MAPPING cells are reproducible with
> `tools/codex-coverage/measure.sh --offline`.

- **Codex builds:** _0.137.0, 0.139.0, and 0.144.1 — Bash observed; 0.144.1 — apply_patch observed_
- **Hook version:** 0.1.0

| Tool / category | emitted? (RUNTIME) | mapped? + action:resource (MAPPING, offline) |
|---|---|---|
| `Bash` (`npm publish`) | yes | mapped: `deploy:pkg/npm/_` |
| `Bash` (`npm test`) | yes | mapped: `execute:shell/npm` |
| `apply_patch` Add (`package.json`) | yes (Codex 0.144.1) | mapped: `write:repo/manifest/npm` |
| `apply_patch` Update (`config/.env`) | yes (surface observed; exact vector offline) | mapped: `write:secret/env` |
| `apply_patch` Delete (`ci.yml`) | yes (surface observed; exact vector offline) | mapped: `delete:ci/workflow` |
| `apply_patch` Move/rename → `.env` | yes (surface observed; exact vector offline) | mapped: `write:secret/env` |
| `apply_patch` multi-file (most-destructive wins) | yes (surface observed; exact vector offline) | mapped: `delete:ci/workflow` |
| `apply_patch` ordinary (`src/index.ts`, abstain) | yes (surface observed; exact vector offline) | abstain |
| `Read` (`.env`) | unmeasured (no Codex runtime in this env) | mapped: `read:secret/env` |
| `Write` (`package.json`) | unmeasured (no Codex runtime in this env) | mapped: `write:repo/manifest/npm` |
| `Edit` (`ci.yml`) | unmeasured (no Codex runtime in this env) | mapped: `write:ci/workflow` |
| `MultiEdit` (`~/.ssh/id_rsa`) | unmeasured (no Codex runtime in this env) | mapped: `write:secret/ssh` |
| `WebFetch` (external host) | unmeasured (no Codex runtime in this env) | mapped: `send:net/external/<host>` |
| `WebSearch` | unmeasured (no Codex runtime in this env) | abstain (operator config required) |
| `mcp__filesystem__read_file` | unmeasured (no Codex runtime in this env) | mapped: `read:fs/<path>` |
| `mcp__github__create_issue` | unmeasured (no Codex runtime in this env) | mapped: `write:github/<owner>/<repo>/issue` |

> `Read`/`Write`/`Edit`/`MultiEdit`/`WebFetch`/`WebSearch` are **Claude Code tool
> names**; whether any Codex build emits a `PreToolUse` event under these names is
> exactly what the `emitted?` column is for. Do not assume `yes`.

## NEXT STEPS — keep the RUNTIME column current

Repeat this procedure for each Codex version you claim to support. Only
unexercised surfaces stay `unmeasured`.

1. **Pin the build.** Install a specific Codex CLI version; record it (and OS) in
   the "Codex build:" line above. Re-measure per version — emission can change
   between builds.
2. **Build the hook.** `npm run build` (the harness needs `dist/src/cli.js`).
3. **Wire the wrapper.** The harness writes a project-local `.codex/hooks.json`
   in a throwaway temp workspace with a `.*` matcher pointing at
   `tools/codex-coverage/log-wrapper.mjs`, so your real `~/.codex` is untouched.
   (To measure your *own* `~/.codex` setup instead, wire the wrapper there with a
   wide `PreToolUse` matcher — but back up and restore it.)
4. **Run the harness.**

   ```bash
   tools/codex-coverage/measure.sh > /tmp/coverage-table.md
   ```

   It drives one probe per category (Bash, apply_patch Add/Update/Delete/Move/
   multi-file, WebFetch, WebSearch; MCP needs a configured server) and reads the
   wrapper's emission log. Each probe costs API budget.
5. **Record results.** Paste the generated table here, set "Codex build:" to the
   pinned version, and flip "WHAT THIS CHANGE DOES" to note which surfaces fired.
   While you have a real run, also capture a **real** `apply_patch` payload and
   reconcile it with `src/apply-patch.ts` (currently `tool_input.command` and the
   `*** Begin Patch` envelope). Replace fixtures if a future release diverges.

## Notes / discipline

- The harness is **measurement only** — it does not change classifier / abstain /
  enforce behavior, and it logs **tool names only** (never raw `tool_input` or
  `grant_ref`).
- Offline regression of the MAPPING column (classification stability across
  refactors) is guarded by
  [`tools/codex-coverage/explain-matrix.sh`](../../../tools/codex-coverage/explain-matrix.sh),
  which is deterministic and does **not** measure runtime emission.

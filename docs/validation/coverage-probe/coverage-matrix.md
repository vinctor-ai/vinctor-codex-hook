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
  it. **Every cell below is `unmeasured (no Codex runtime in this env)` until the
  runbook is run against a pinned build.**
- **MAPPING coverage — `mapped?` + `action:resource`** Given the event, does the
  hook classify it, and to what `(action, resource)`? Deterministic; measured
  **offline** by the real hook CLI (`explain --json`). These cells are filled.

A mapped tool is **not** proof Codex emits the event for it. `emitted?` is the
only column that proves the boundary is actually reachable on a given build.

## WHAT THIS CHANGE DOES — current state

- The MAPPING columns are filled from the real CLI (`vinctor-codex-hook` 0.1.0-preview.2),
  offline. No `/v1/enforce` call is made.
- Every RUNTIME (`emitted?`) cell is `unmeasured (no Codex runtime in this env)`.
  No Codex build has been driven through the harness in this environment, so no
  emission is claimed.

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

**Conclusive measurement still requires a real, pinned Codex build run through the
disambiguated harness** (see NEXT STEPS below). Until the wrapper is confirmed
invoked against such a build, the `emitted?` cells stay `unmeasured`.

## Measurement runs (dated)

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

**Conclusion:** on 0.137.0, `codex exec` (headless) does not load or run plugin
`PreToolUse` hooks at all — through neither the `hooks.json` nor the plugin path.
Hook firing appears limited to the interactive TUI, which this environment cannot
drive headlessly. The `emitted?` cells therefore remain `unmeasured`; the README
firing caveat is, if anything, understated.

## Coverage table

> RUNTIME cells: replace with `yes` / `no` only after running the runbook on a
> real build, and record the version below. MAPPING cells are reproducible with
> `tools/codex-coverage/measure.sh --offline`.

- **Codex build:** _0.137.0 (gpt-5.5) driven 2026-06-21 — wrapper never invoked via either hooks.json or the plugin path (see [Measurement runs](#measurement-runs-dated)); `emitted?` still unmeasured_
- **Hook version:** 0.1.0-preview.2

| Tool / category | emitted? (RUNTIME) | mapped? + action:resource (MAPPING, offline) |
|---|---|---|
| `Bash` (`npm publish`) | unmeasured (no Codex runtime in this env) | mapped: `deploy:npm/package` |
| `Bash` (`npm test`, abstain) | unmeasured (no Codex runtime in this env) | abstain |
| `apply_patch` Add (`package.json`) | unmeasured (no Codex runtime in this env) | mapped: `write:repo/manifest/npm` |
| `apply_patch` Update (`config/.env`) | unmeasured (no Codex runtime in this env) | mapped: `write:secret/env` |
| `apply_patch` Delete (`ci.yml`) | unmeasured (no Codex runtime in this env) | mapped: `delete:ci/workflow` |
| `apply_patch` Move/rename → `.env` | unmeasured (no Codex runtime in this env) | mapped: `write:secret/env` |
| `apply_patch` multi-file (most-destructive wins) | unmeasured (no Codex runtime in this env) | mapped: `delete:ci/workflow` |
| `apply_patch` ordinary (`src/index.ts`, abstain) | unmeasured (no Codex runtime in this env) | abstain |
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

## NEXT STEPS — how to fill the RUNTIME column on a real Codex build

The top open item in `ROADMAP.md`. Until step 5, the `emitted?` cells stay
`unmeasured` and the README firing caveat is the honest stance.

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
   reconcile it with `src/apply-patch.ts` (the `input` field name and the
   `*** Begin Patch` envelope), and confirm whether `permissionDecision:"allow"`
   actually takes effect on that build (one source claims Codex rejects `allow`
   too, not just `ask`). Replace any hand-authored apply_patch fixtures with the
   captured payload if they diverge.

## Notes / discipline

- The harness is **measurement only** — it does not change classifier / abstain /
  enforce behavior, and it logs **tool names only** (never raw `tool_input` or
  `grant_ref`).
- Offline regression of the MAPPING column (classification stability across
  refactors) is guarded by
  [`tools/codex-coverage/explain-matrix.sh`](../../../tools/codex-coverage/explain-matrix.sh),
  which is deterministic and does **not** measure runtime emission.

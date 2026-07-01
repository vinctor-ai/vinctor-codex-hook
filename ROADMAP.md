# Roadmap

> Vinctor Codex CLI Hook — work tracked after v0.1.0.

This document is **not a release commitment.** It records the most valuable next
steps and the items deliberately deferred during v0.1.0. Treat it as a working
ledger, not marketing. For the current contract, see
`docs/superpowers/specs/2026-06-10-vinctor-codex-hook-design.md`.

---

## Shipped — v0.1.0 (Boundary Preview), incl. claude-hook parity

The Codex counterpart to the Claude Code hook, adapted to Codex's real
`PreToolUse` contract, and brought to **full feature/scope parity** with
`vinctor-claude-code-hook` (every claude-hook tool surface + test case, plus the
Codex-specific `apply_patch` and abstain semantics):

- **Three outcomes:** mapped+permit → `allow`; mapped+fail-closed → `deny`;
  unmapped → **abstain** (empty stdout). Codex has no `ask`, so abstaining is the
  defer-to-user equivalent.
- **`Bash`** — classifier-aware (`git`/`npm`·`pnpm`·`yarn`/`docker`/`gh`) plus
  pattern defaults (secrets-read, release-publish, infra-ops, exfiltration).
- **`apply_patch`** (Codex-specific) — the patch envelope is parsed for target
  paths; secret and protected paths map to `write`/`delete:<resource>`; ordinary
  edits abstain. One `/v1/enforce` call per patch (most-destructive match wins).
- **`Read`/`Write`/`Edit`/`MultiEdit`** — secret + protected file paths, read &
  write side, by `file_path` (ported from claude-hook).
- **`WebFetch`** — universal `send:net/<scope>/<host>` mapping + per-host override.
  **`WebSearch`** — matcher-only.
- **MCP** — matcher + built-in classifiers for `filesystem`, `github`, `slack`.
- **Config** — `.vinctor/codex-hook.json` (override `VINCTOR_CODEX_HOOK_CONFIG`);
  the same rule schema and specificity engine as the Claude hook.
- **Offline tooling** — `validate` and `explain` subcommands; `--version`/`--help`.
- **Tests** — all claude-hook test cases ported (semantic parity: `ask`→abstain,
  `HookResponse`-aware) + apply_patch coverage. Opt-in `test-integration/`
  (enforce-wire + full hook-path wire) via `npm run test:integration`.
- **Non-disclosure ratchets** — no `grant_ref` / `audit_event_id` / raw tool input
  / mapped scope ever appears in model-facing output, across every tool surface.
- **Strict `/v1/enforce` body** — `{grant_ref, action, resource}` + `X-Agent-Key`.
  The contract is not extended here.

> **Honesty note on the superset.** `Read`/`Write`/`Edit`/`MultiEdit`/`WebFetch`/
> `WebSearch` are Claude Code tool names. They are implemented so the boundary is
> ready if a runtime emits them, but Codex firing `PreToolUse` for web/file/MCP
> tools is version-dependent and **not guaranteed** — see the README caveat. The
> hook classifies; it does not make Codex fire.

---

## Deferred (candidate next work)

### ★ TOP PRIORITY — measure real-Codex `PreToolUse` firing
This is the single most valuable unverified thing about the project. Everything
shipped proves the hook *classifies* every surface correctly (headless dogfood +
service-backed E2E, both passing) — but **none of it proves Codex actually fires
`PreToolUse` for a given tool on a given build.** Codex's own docs call
`PreToolUse` "a guardrail rather than a complete enforcement boundary," and
`apply_patch` / most MCP tool calls have been unreliable to fire on some builds
(openai/codex#16732, #17794). `Read`/`Write`/`Edit`/`MultiEdit`/`WebFetch`/
`WebSearch` are Claude Code tool names Codex may never emit at all.

**CONTEXT — why the harness work exists.** The measurement procedure below used to
live only as prose. It is now a *reproducible instrument* so anyone with a real
Codex build can fill the gap without reinventing the rig:
- [`tools/codex-coverage/measure.sh`](tools/codex-coverage/measure.sh) +
  [`log-wrapper.mjs`](tools/codex-coverage/log-wrapper.mjs) — drives one probe per
  tool category (Bash + variants, apply_patch Add/Update/Delete/Move/multi-file,
  MCP, Read/Write/Edit/MultiEdit/WebFetch/WebSearch) and records, per tool:
  **emitted?** (RUNTIME), **mapped?** + **action:resource** (MAPPING, offline).
- [`tools/codex-coverage/explain-matrix.sh`](tools/codex-coverage/explain-matrix.sh)
  — deterministic OFFLINE regression vectors that pin the MAPPING column
  (classification only; **not** runtime emission), so a classifier refactor that
  silently changes a mapping is caught.
- [`docs/validation/coverage-probe/coverage-matrix.md`](docs/validation/coverage-probe/coverage-matrix.md)
  — the matrix + the runbook for filling it on a real build.

**WHAT THIS CHANGE DID — current state.** The harness, the offline regression
vectors, and the matrix scaffold are in place. The MAPPING column is filled
(offline, from the real CLI); **every RUNTIME `emitted?` cell is `unmeasured (no
Codex runtime in this env)`.** No Codex build has been driven through the harness
in this environment, so no emission is claimed. Nothing in classifier / abstain /
enforce behavior changed — this is harness + docs only.

**NEXT STEPS — measurement procedure (not yet run here — needs a real Codex CLI):**
1. Install a pinned Codex CLI build; record the version (and OS) in the matrix.
2. Wire the wrapper into `PreToolUse` with a wide matcher. (`measure.sh` does this
   in a throwaway project-local `.codex/` so `~/.codex` is never touched.)
3. Run `tools/codex-coverage/measure.sh` — it drives a shell command, file edits
   (apply_patch), an MCP tool call, and (if the build has them) a web fetch/search.
4. Record which produced a `PreToolUse` event, and the exact `tool_name` +
   `tool_input` shape for each. Capture a **real** apply_patch payload and
   reconcile it with `src/apply-patch.ts` (`patchTextFromInput` field name; the
   `*** Begin Patch` envelope). Also confirm whether `permissionDecision:"allow"`
   actually takes effect on that build (one source claims Codex rejects `allow`
   too, not just `ask` — see research notes).
5. Paste the generated table into the matrix, set the Codex version, and update the
   README coverage table + caveat to state, per version, exactly which surfaces
   fire. Replace any hand-authored apply_patch fixtures with the captured payload.

Until step 5, the README caveat ("supported so the boundary is ready if a runtime
emits them … the hook classifies, it does not make Codex fire") and the
`unmeasured` RUNTIME cells are the honest stance and must stay.

### `PermissionRequest` hook
Codex also exposes a blocking `PermissionRequest` hook (for routing approvals to an
external UI/policy engine, openai/codex#15311). Whether Vinctor should additionally
attach there — and how it composes with `PreToolUse` — is an open design question.

### Multi-path apply_patch enforcement
A patch touching several in-boundary paths is enforced as a single most-destructive
match (the v1 contract is one action per enforce call). If operators need every
in-boundary path checked, that requires either batch-enforce semantics (a main-repo
contract change, out of scope here) or multiple sequential enforce calls with
defined short-circuit behavior. Deferred until there is demand.

### More MCP server classifiers
`postgres`/database servers (destructive-query risk) and browser/puppeteer servers
(external network) — same approach as the Claude hook's roadmap. Deferred until
operator signal.

### `notify` integration (observability, not enforcement)
Codex's `notify` program fires post-hoc on `agent-turn-complete` and **cannot
block**. It is not an authorization surface, but could feed turn-level signal to an
operator dashboard. Strictly out of the enforcement boundary; noted only so it is
not confused with the hook.

### Richer config
Nested MCP `inputField` (JSONPath); per-rule toggles to disable a built-in
classifier or pattern. Same tradeoffs as the Claude hook; deferred.

---

## Out of scope (affirmed)

- Official Codex plugin / integration. This is a hook boundary, not a plugin.
- Sandboxing / OS-level isolation. Codex owns its sandbox; this hook does not.
- Raw shell/tool interception or hook-bypass detection.
- Hosted Vinctor service, or grant issuance, in this repo.
- Approval workflow / escalation queue.
- Modifying the Vinctor v1 `/v1/enforce` body contract.
- LLM-based risk classification.
- A generic multi-runtime library API. The CLI is the only public interface; if
  shared logic with the Claude hook is worth extracting, that belongs in a separate
  ADR, not here.

---

## Operational / release

- **Maturity vs. parity.** The code surface is at parity with (a superset of) the
  Claude Code hook, and now has a headless dogfood matrix + a passing
  service-backed E2E. But maturity is not parity: the Claude hook was hardened over
  three iterative cycles with external operator dogfoods. The equivalent here is
  the real-Codex firing measurement above. Keep the preview label until that lands.
- **Incremental, traceable changes.** Land further work as small, single-purpose
  commits/PRs (as the Claude hook did) rather than large squashes, so a regression
  can be bisected to a specific change.
- **CI** — GitHub Actions running `npm test` on PR + main (Node 20/22 matrix).
- **First npm publish** — deferred until design-partner signal and a resolved
  product name. Publishing locks the package name and commits to the API shape.
- **Vinctor rename** — if the product name changes, update: repo name,
  `package.json` name/description, README/docs, the env var prefix
  (`VINCTOR_*` → `<NEW>_*`, a breaking change to coordinate with the service), the
  config filename (`codex-hook.json`), LICENSE holder, and this file. The frozen
  `docs/superpowers/**` specs/plans should get a note rather than a rewrite.
- **Repo hygiene before public** — `SECURITY.md`, `CONTRIBUTING.md`, issue/PR
  templates, Dependabot.

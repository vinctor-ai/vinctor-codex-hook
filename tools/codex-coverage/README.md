# Codex PreToolUse coverage-measurement harness

A reproducible instrument for answering, per tool category, on a **pinned Codex
build**:

1. **emitted?** — does Codex fire a `PreToolUse` event for this tool at all?
   *(RUNTIME coverage — version-dependent, needs a real Codex CLI.)*
2. **mapped?** — does the hook classify the event (vs. abstain)?
3. **action:resource** — the `(action, resource)` the hook would send to
   `/v1/enforce`.
   *(2 and 3 are MAPPING coverage — answered offline by the real hook CLI.)*

## Why this exists

Everything shipped so far proves the hook *classifies* every surface correctly
(headless dogfood + service-backed E2E). **None of it proves Codex actually fires
`PreToolUse` for a given tool on a given build.** Codex's own docs call
`PreToolUse` "a guardrail rather than a complete enforcement boundary";
`apply_patch` and most MCP tool calls have been unreliable to fire on some builds
(openai/codex#16732, #17794); and `Read`/`Write`/`Edit`/`MultiEdit`/`WebFetch`/
`WebSearch` are **Claude Code tool names** Codex may never emit at all. This
harness turns that open question into a checklist you fill against a real build.

Keep the two coverage kinds separate. A tool the hook **maps** is *not* proof
that Codex **emits** the event for it. The `emitted?` column is the only thing
that proves a surface is actually reachable by the boundary on a given build.

## Files

| File | Role |
|---|---|
| `measure.sh` | The harness. Wires the logging wrapper, drives one probe per tool category, then prints a markdown coverage table. |
| `log-wrapper.mjs` | Catch-all `PreToolUse` hook used **only during measurement**. Logs the emitted `tool_name` (one JSON line each) and emits nothing so the agent proceeds. It is **not** the real hook — it does not classify, map, or call `/v1/enforce`. |

## Non-disclosure

- `log-wrapper.mjs` records **`{hook_event_name, tool_name}` only**. It never
  persists `tool_input` (raw command / patch text / path / URL), and the Codex
  `PreToolUse` event carries no `grant_ref`.
- The MAPPING columns print the classifier's `(action, resource)` — the *mapped
  scope*, which is the measurement's purpose — via `explain --json`. `explain`
  never calls `/v1/enforce`, so no `grant_ref`/`audit_event_id` is involved.
- The harness does not change classifier / abstain / enforce behavior. It is an
  observer.

## Codex 0.137.0+ note

On codex-cli 0.137.0+, hook loading is controlled by the **plugin system**. If the
log wrapper is never invoked (no emissions recorded at all), that may be a hook
**load failure**, not absence of emission — confirm the wrapper actually loaded
before recording any cell as a negative. See
[`docs/validation/coverage-probe/coverage-matrix.md`](../../docs/validation/coverage-probe/coverage-matrix.md),
which documents this.

## Usage

```bash
npm run build                            # produces dist/src/cli.js (required)

# Mapping columns only — reproducible anywhere, no Codex needed:
tools/codex-coverage/measure.sh --offline

# Full run on a real, authenticated Codex CLI (each probe costs API budget):
tools/codex-coverage/measure.sh
```

The markdown table goes to **stdout**; progress + the raw emission-log path go to
**stderr**. Redirect to capture just the table:

```bash
tools/codex-coverage/measure.sh > /tmp/coverage-table.md
```

## How to fill the matrix on a real Codex build

See the runbook in
[`docs/validation/coverage-probe/coverage-matrix.md`](../../docs/validation/coverage-probe/coverage-matrix.md):
pin the Codex version, wire the wrapper (the harness does this in a throwaway
project-local `.codex/` — `~/.codex` is never touched), run `measure.sh`, and
paste the emitted table in, recording the exact version. Until then every
`emitted?` cell stays **"unmeasured (no Codex runtime in this env)."**

## Discipline

- Measurement only. Never claim `emitted?` coverage that the harness did not
  actually observe against a real build.
- A throwaway temp workspace + project-local `.codex/hooks.json` is used so your
  real `~/.codex` config is never modified.
- The probes are sandboxed (`--sandbox workspace-write`) and directive (one tool
  category each) so the run is cheap and the emitted set is unambiguous.

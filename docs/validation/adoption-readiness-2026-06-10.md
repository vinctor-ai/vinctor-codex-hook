# Adoption Readiness — Operator-from-Docs Evaluation

> Historical validation snapshot. Plugin packaging, real Codex Bash/apply_patch
> measurements, and current permit wire semantics landed after this evaluation;
> use the README and coverage matrix for current behavior.

- **Date:** 2026-06-10
- **Version under test:** 0.1.0-preview (parity build, `dist/src/cli.js`)
- **Method:** An adversarial sub-agent acted as a brand-new operator wiring the
  hook into Codex CLI using **only** operator-facing docs (`README.md`,
  `docs/configuration.md`, `docs/troubleshooting.md`, `examples/`, `ROADMAP.md`).
  `src/` was never opened to resolve a doc gap. The built CLI was run to observe
  real behavior; no live Vinctor service (so offline signals only).

## Verdict

An operator can wire the hook from the docs alone today: the wiring snippet is
copy-pasteable and correct (shebang + exec bit + `bin` verified), the
offline-evaluation story reproduced exactly, and the abstain / coverage caveats
are present and unusually candid. The highest-risk item was **coverage over-trust**
— `explain` printed a bare `MAPPED` for WebFetch/file tools with no inline hint
that Codex may never fire those events. The eval also found a `validate` exit-code
false-positive and two minor doc nits.

## Findings and resolutions

All actionable findings were fixed in this validation cycle (preview.2):

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | High (expectation) | `explain` showed `MAPPED` for WebFetch/Read/Write/Edit/MultiEdit/WebSearch with no firing caveat → operator over-trust | `explain` now appends a "this is a Claude Code tool name; Codex firing is version-dependent … MAPPED means *would be checked if Codex fires*" note for those tools. README coverage table marks them with `†` pointing at the caveat. |
| 2 | Medium | `validate <explicit nonexistent path>` returned exit **0** ("built-ins only") — a typo'd path silently passed | `validate` now exits **2** with `config file not found` when an *explicitly-named* path is missing. The default-path-absent case still exits 0 (genuinely "no config"). |
| 3 | Medium (trap) | Broadening the matcher (e.g. `.*`) makes unrecognized tools **deny** (fail-closed), not abstain | Added a "keep the matcher scoped" caution next to the wiring snippet in README. (Behavior is intended fail-closed; now documented.) |
| 4 | Low | README and `examples/README.md` had two different wiring matchers | Aligned `examples/README.md` to the full README matcher. |
| 5 | Low | `--help` omitted `VINCTOR_HOOK_DEBUG` | Added to the `--help` env-var list. |
| 6 | Low | Abstain emits no JSON, so `\| jq` errors on empty input | Added a troubleshooting note that this is expected. |

## What the eval confirmed works (don't lose it)

- **Honesty.** The Codex firing caveat, "not an official plugin / not raw
  interception," and the ROADMAP "honesty note on the superset" are exactly what an
  adversarial reader hopes to find.
- **Offline evaluation story** — mapped → `missing_auth_env`, unmapped → abstain,
  dead endpoint → `service_unavailable` — every documented offline outcome
  reproduced exactly (incl. partial-env → `missing_auth_env`).
- **`explain` is the star** — decision, action, resource, source, and the winning
  rule; its abstain text names Codex's native flow. (Now also carries the
  firing-uncertainty note for Claude-Code-named tools.)
- **apply_patch** — multi-file "most-destructive wins" is order-independent;
  `Move to:` retargets to the destination path; ordinary edits abstain. Verified.
- **Clean error UX** — unknown subcommand and malformed events fail with helpful
  messages and exit 2 / fail-closed deny.

## Still open (tracked in ROADMAP)

The eval reiterated the project's central unverified risk: `explain`/dogfood prove
the hook **classifies** every surface, but not that **Codex fires** `PreToolUse`
for a given tool/build. That measurement (against a real Codex install) remains the
ROADMAP top priority.

# Plan — Vinctor Codex CLI Hook v0.1.0

Spec: `docs/superpowers/specs/2026-06-10-vinctor-codex-hook-design.md`.

This records the build order and verification for v0.1.0. The hook reuses the
Claude Code hook's runtime-agnostic core verbatim and adds Codex-specific surfaces.

## Reused verbatim (no behavior change)

`errors`, `mcp-name`, `enforce-client`, `classifiers/{git,npm,docker,gh,
secret-reader,sensitive-paths}`, `classifiers/mcp/{filesystem,github,slack}`,
`classifiers/index`, `commands/validate`, `defaults/{release-publish,infra-ops,
exfiltration}`, and their tests. These depend only on a normalized command string
or a `(tool, input)` record, both of which are identical across runtimes.

## Built for Codex

1. **types** — tool surface is `Bash | apply_patch | mcp__*`; `Decision` is
   `allow | deny` only; `HookResponse` adds an `abstain` variant; event type gains
   optional `model`/`turn_id`.
2. **apply-patch** — `parseApplyPatchOps` (envelope → `{action, path}` ops) and
   `patchTextFromInput` (`input` ?? `patch`).
3. **parser** — Bash (as before), apply_patch (parse envelope; missing text →
   malformed, null byte → unsafe, no ops → empty list), MCP. Web/file tools removed.
4. **output** — `allow`/`denyFor` envelopes, `decision()` wrapper, `abstain()`.
   No `ASK_REASON`.
5. **config** — valid tools `Bash`/`apply_patch`/`mcp__*`; env override
   `VINCTOR_CODEX_HOOK_CONFIG`.
6. **defaults** — `secrets` reduced to Bash reads; new `protected-paths`
   (`classifyProtectedPath`) for apply_patch; `index` aggregates Bash defaults only.
7. **mapping** — Bash/MCP via the single-input engine; `resolveApplyPatch` over op
   paths (config → secret/protected built-ins; most-destructive winner).
8. **hook** — unmapped → `abstain()`; mapped → enforce → `allow`/fail-closed `deny`.
9. **cli** — abstain emits empty stdout; Codex help text; `VINCTOR_CODEX_HOOK_CONFIG`.
10. **commands/explain, render** — apply_patch op-summary display; abstain wording.

## Tests (node --test, strict TS)

Per-module: parser, apply-patch, mapping (incl. multi-op winner + config override),
config, output, hook (full decision matrix incl. abstain + apply_patch + MCP),
cli, cli-flags (subcommands), commands/{validate,explain,render}, defaults
(secrets, protected-paths, + the 3 copied), classifiers (copied), enforce-client
(copied), enforce-body-strict (copied), mcp-name (copied).

Invariant ratchets: no-grant-ref, no-audit-event-id, no-tool-input (Bash/
apply_patch/MCP + abstain), no-subcommand, reason-templates.

## Verification

- `npm test` — 296 tests pass.
- `npm run build` — clean (strict + noUncheckedIndexedAccess).
- CLI smoke: allow (mock service), action_denied (mock 403), service_unavailable,
  missing_auth_env, malformed_payload, abstain (empty stdout), apply_patch secret,
  validate, explain, --version/--help, unknown subcommand (exit 2).
- Claim-safety scan: no prohibited claims (official plugin / sandbox / raw
  interception / production-ready / issues grants), only negated disclaimers.
- `grt_`/`evt_` never present in any output across the decision matrix.

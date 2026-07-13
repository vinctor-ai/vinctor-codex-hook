# Integration tests

Run all of them with:

```bash
npm run test:integration
```

Each suite self-skips when its prerequisite is missing, so the command is safe to
run anywhere.

## `local-service-e2e` — always runs

Self-contained: spins up an in-process mock `/v1/enforce` and drives the full hook
path (parse → map → enforce → decide) through permit / deny / fail-closed /
abstain / missing-auth, plus strict body, `X-Agent-Key`, and non-disclosure on the
live path. No external dependency.

## `mock-service-smoke` — shared vinctor-core fixture

CLI-level smoke tests against the **shared** mock Vinctor service from
[`vinctor-core`](https://github.com/vinctor-ai/vinctor-core/blob/main/tools/mock_vinctor_service.py)
(`tools/mock_vinctor_service.py`), so every runtime hook exercises one
deterministic contract. Spawns the mock and runs the built CLI (`dist/src/cli.js`)
against it. Covers permit, deny, invalid/missing `X-Agent-Key` (fail-closed), strict
body, `X-Vinctor-Boundary-Id` forwarding, unreachable endpoint (fail-closed), and
abstain.

Requires `python3` and the mock script. By default it expects a sibling checkout at
`../vinctor-core`; override with `VINCTOR_MOCK_SERVICE=/path/to/mock_vinctor_service.py`.
Skipped if neither is found.

## `enforce-wire` / `hook-wire` — real service, opt-in

Skipped unless these env vars point at a **running** Vinctor service:

- `VINCTOR_E2E_ENDPOINT`
- `VINCTOR_E2E_AGENT_KEY`
- `VINCTOR_E2E_GRANT_REF`

They require an active grant covering `execute:ci/test` (`enforce-wire`) and
`deploy:npm/package` (`hook-wire`, full `handleEvent` path).

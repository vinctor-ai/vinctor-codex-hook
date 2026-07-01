# Examples

## `codex-hook.json`

A sample operator policy. Copy it to `.vinctor/codex-hook.json` (or point
`VINCTOR_CODEX_HOOK_CONFIG` at it) and adapt. Validate it offline:

```bash
node ../dist/src/cli.js validate codex-hook.json
```

It demonstrates one rule per supported tool surface:

- a `Bash` prefix rule (`terraform destroy` → `delete:infra/terraform/destroy`),
- two `apply_patch` glob rules matched against patched file paths
  (`**/secrets/**` → `write:secret/app`, `**/migrations/**` → `deploy:db/migration`),
- an MCP `inputField` rule (`mcp__filesystem__read_file` on `**/etc/**` →
  `read:secret/etc`).

## Wiring into Codex

Register the built CLI for the `PreToolUse` event in `~/.codex/hooks.json` (or
`.codex/hooks.json`):

> [!IMPORTANT]
> Codex's hook-loading mechanism is version-dependent. A real measurement run against codex-cli 0.137.0 found that recent builds load hooks through the **plugin system**, and a project-local `.codex/hooks.json` does **not** load on 0.137.0. The `hooks.json` / `config.toml` wiring shown here reflects builds that read hook config directly — verify it actually loads on your Codex version. Runtime hook firing on 0.137.0 is currently **unmeasured/inconclusive** (see `docs/validation/coverage-probe/coverage-matrix.md`).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|apply_patch|Edit|Write|Read|MultiEdit|WebFetch|WebSearch|mcp__.*",
        "hooks": [{ "type": "command", "command": "/abs/path/vinctor-codex-hook/dist/src/cli.js" }]
      }
    ]
  }
}
```

Then set `VINCTOR_ENDPOINT`, `VINCTOR_AGENT_KEY`, and `VINCTOR_GRANT_REF` in the
Codex session. See the repo [README](../README.md) and
[docs/configuration.md](../docs/configuration.md) for the full reference.

# Configuration Reference

Operator policy for the Vinctor Codex CLI Hook lives in a single JSON file. This
document is the full reference: file location, schema, matching semantics, and
worked examples. For a one-paragraph orientation, see the "Configuration" section
of the [README](../README.md).

The config file defines **mapping** behavior — how a Codex tool call is translated
into an `(action, resource)` pair. It does not make the final permit/deny decision;
the Vinctor authorization service does. A rule that matches routes the call through
`/v1/enforce`; a call that matches nothing causes the hook to **abstain** (emit no
decision), and Codex's native approval flow applies.

---

## File location

- Default path: `.vinctor/codex-hook.json` (relative to the hook's working
  directory, which Codex sets to the project root).
- Override: set `VINCTOR_CODEX_HOOK_CONFIG` to an absolute path.
- The file is **optional**. If it is absent, the hook uses only its built-in
  mappings. An absent file is not an error.
- If the file is present but its JSON or schema is invalid, the hook fails closed:
  every call denies with `invalid_config` until you fix it.

---

## Top-level shape

```json
{
  "version": 1,
  "rules": [
    { "tool": "...", "matchType": "...", "pattern": "...", "action": "...", "resource": "..." }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Must be exactly the number `1`. Any other value is rejected. |
| `rules` | yes | An array. May be empty (`[]`) — that just means "built-in mappings only." |

---

## Rule fields

| Field | Required | Allowed values | Notes |
|---|---|---|---|
| `tool` | yes | `Bash`, `apply_patch`, `Read`, `Write`, `Edit`, `MultiEdit`, `WebFetch`, `WebSearch`, or an MCP tool name `mcp__<server>__<tool>` | The MCP form must have a non-empty server segment and a non-empty tool segment. See the [Codex hook-firing caveat](../README.md#tool-coverage) for which of these Codex actually emits events for. Hook firing is version-dependent and must be measured on your installed Codex build — see [`docs/validation/coverage-probe/coverage-matrix.md`](validation/coverage-probe/coverage-matrix.md). |
| `matchType` | yes | `exact`, `prefix`, `glob` | See [Match types](#match-types). |
| `pattern` | yes | non-empty string | What it is matched against depends on the tool — see [What `pattern` matches against](#what-pattern-matches-against). |
| `action` | yes | `read`, `write`, `execute`, `deploy`, `delete`, `send` | The v1 authorization verbs. No other verb is accepted. |
| `resource` | yes | non-empty string, **no `*`** | The resource identifier sent to the authorization service. Wildcards are rejected here — the resource must be explicit. |
| `inputField` | no | string of `[A-Za-z0-9_]` only | Only meaningful for MCP tools. See [MCP `inputField`](#mcp-inputfield). Ignored for `Bash`/`apply_patch`. |

Any rule that violates these constraints causes the whole config to be rejected
with `invalid_config`.

---

## Match types

| `matchType` | Matches when… | Example |
|---|---|---|
| `exact` | the input string equals `pattern` exactly | `pattern: "npm test"` matches only `npm test` |
| `prefix` | the input equals `pattern`, **or** begins with `pattern` followed by a space | `pattern: "npm publish"` matches `npm publish` and `npm publish --tag beta`, but not `npm publish-extra` |
| `glob` | the input matches `pattern` as a glob (dotfiles included) | `pattern: "**/.env*"` matches `.env`, `repo/.env.production` |

Glob semantics (the hook uses [micromatch](https://github.com/micromatch/micromatch)
with `dot: true`): `*` matches within a single path segment; `**` matches across
segments; leading-dot files are matched.

---

## What `pattern` matches against

The hook normalizes the input to a string (or, for `apply_patch`, per-file paths)
before matching:

| Tool | `pattern` is matched against |
|---|---|
| `Bash` | the normalized command (trimmed, internal whitespace collapsed to single spaces) — e.g. `npm   publish` → `npm publish` |
| `apply_patch` | each target file path extracted from the patch (leading `./` stripped, `~/` expanded, leading `/` stripped). A rule matches if it matches **any** op's path. See [apply_patch](#apply_patch). |
| `Read` / `Write` / `Edit` / `MultiEdit` | the normalized file path (leading `./` stripped, `~/` expanded, `..` resolved against `cwd`, leading `/` stripped) |
| `WebFetch` | the host only — no scheme, port, path, query, fragment, or credentials — e.g. `https://user:pass@api.example.com/v1?x=1` → `api.example.com` |
| `WebSearch` | the search query string |
| `mcp__<server>__<tool>` without `inputField` | the full tool name, e.g. `mcp__notion__create_page` |
| `mcp__<server>__<tool>` with `inputField` | the value of that top-level `tool_input` field |

### Bash matching is literal, not a shell

The hook does **not** parse or execute shell syntax. It matches your `pattern`
against the command string after only two normalizations: trim, and collapse
internal whitespace. It does not split on `;`, `&&`, or `|`; it does not strip
`sudo` or leading `VAR=value` assignments; it does not resolve `..`. Built-in Bash
classification keys on the first token.

Practical consequences (deliberate — the hook is a deterministic translator, not a
shell sandbox): `sudo cat .env` is a different string from `cat .env`; in
`ls; cat .env` the first token is `ls`; `cat ../.env` is matched literally.
Defense against deliberately obfuscated commands is the authorization service's and
operator's responsibility, not a pre-execution string matcher's.

---

## apply_patch

Codex performs file edits through a single `apply_patch` tool whose `tool_input`
carries a patch envelope:

```
*** Begin Patch
*** Add File: path/a        (→ write)
+...
*** Update File: path/b     (→ write; an optional "*** Move to: path/c" retargets it)
@@ ...
*** Delete File: path/d     (→ delete)
*** End Patch
```

The hook extracts one operation per file. Built-in classification then checks each
target path: sensitive paths (`.env`, `.ssh` keys, cloud credentials) →
`secret/<kind>`; protected paths (CI workflows, `package.json`, Dockerfiles,
Terraform, k8s manifests) → their resource. The **action** comes from the op
(`write` for Add/Update/Move, `delete` for Delete). Ordinary file edits match
nothing → the hook abstains.

**One decision per patch.** `/v1/enforce` takes a single `(action, resource)`, so
when one patch touches several in-boundary paths the hook enforces the single
**most destructive** match (`delete` over `write`), breaking ties by the most
specific resource. Other in-boundary paths in the same patch are not separately
enforced in this preview.

Operator `apply_patch` rules match `pattern` against the op paths and supply an
explicit `action`/`resource`, overriding the built-in path classification.

---

## Resolution order and specificity

1. **Operator config rules** (this file). All rules whose `tool` matches and whose
   `matchType`/`pattern` matches are collected; the most specific one wins.
   Operator config always beats built-in mappings.
2. **Built-in mappings** — Bash classifiers, the apply_patch path classifier, MCP
   server classifiers, and Bash pattern defaults shipped with the hook.
3. If nothing matches, the result is `Unmapped` → the hook abstains.

When more than one config rule matches: `exact` beats `prefix` beats `glob`; then
more literal tokens wins; then fewer `*` wins; then longer pattern wins.

---

## MCP tool names

An MCP `tool` value must match `mcp__<server>__<tool>` with both segments
non-empty. The server segment is everything between `mcp__` and the first `__`; the
tool segment is the remainder. Both may contain single underscores — e.g.
`mcp__notion_internal__create_page` parses as server `notion_internal`, tool
`create_page`. Only an empty server (`mcp____tool`) or empty tool (`mcp__server__`)
is rejected.

---

## MCP `inputField`

By default, an MCP rule matches on the **tool name**. `inputField` names a single
**top-level** field of the call's `tool_input`; when set, `pattern` is matched
against that field's string value instead.

```json
{
  "tool": "mcp__filesystem__read_file",
  "matchType": "glob",
  "pattern": "**/etc/**",
  "inputField": "path",
  "action": "read",
  "resource": "secret/etc"
}
```

If the field is present and a non-empty string with no null byte, `pattern` is
matched against its value. If the field is missing, non-string, empty, or contains
a null byte, the rule simply **does not match** (it is skipped) — not a deny.

> **Note on built-in MCP classifiers.** `filesystem`, `github`, and `slack` ship
> built-in classifiers. For those servers, a call that does *not* match your config
> rule still falls through to the built-in, which may map it anyway. To see the
> pure "non-match → abstain" behavior, test with a server that has no built-in
> (e.g. `mcp__notion__...`). Your config rule always wins when it matches.

Only top-level fields are supported in the preview. Nested access (JSONPath) is a
future consideration tracked in [ROADMAP.md](../ROADMAP.md).

---

## Examples

### Block edits of a custom secret file

The built-ins already cover `.env`, SSH keys, and cloud-credential files. To add
your own, e.g. `secrets.yaml`:

```json
{
  "version": 1,
  "rules": [
    { "tool": "apply_patch", "matchType": "glob", "pattern": "**/secrets.yaml", "action": "write", "resource": "secret/app" }
  ]
}
```

### Route a Bash command family

```json
{
  "version": 1,
  "rules": [
    { "tool": "Bash", "matchType": "prefix", "pattern": "terraform destroy", "action": "delete", "resource": "infra/terraform/destroy" }
  ]
}
```

### Route an MCP tool with no built-in classifier

```json
{
  "version": 1,
  "rules": [
    { "tool": "mcp__notion__create_page", "matchType": "exact", "pattern": "mcp__notion__create_page", "action": "write", "resource": "notion/page" }
  ]
}
```

### Route MCP calls by an input field

```json
{
  "version": 1,
  "rules": [
    { "tool": "mcp__filesystem__read_file", "matchType": "glob", "pattern": "**/etc/**", "inputField": "path", "action": "read", "resource": "secret/etc" }
  ]
}
```

---

## Checking your config

Use `validate` to lint a config offline (every error at once, with rule index and
field), and `explain` to see how a specific event would map without calling the
service:

```bash
node dist/src/cli.js validate .vinctor/codex-hook.json
node dist/src/cli.js explain /tmp/event.json
```

Add `--json` for a structured object. `validate` exits 0 valid / 1 invalid / 2
unreadable; `explain` exits 0 for mapped/unmapped, 1 for a broken config, 2 for an
unreadable or malformed event.

You can also pipe a representative `PreToolUse` event through the CLI. Run without
auth env set, so a mapped call returns `deny: missing_auth_env` ("mapped, reached
for the service") and an unmapped call emits nothing (abstain):

```bash
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: config/secrets.yaml\n+x\n*** End Patch"}}' \
  | VINCTOR_CODEX_HOOK_CONFIG="$PWD/.vinctor/codex-hook.json" node dist/src/cli.js | jq
```

- `deny: missing_auth_env` → your rule (or a built-in) mapped the call.
- empty output → nothing matched; the hook abstained. Check the tool name, the
  `matchType`, and what the `pattern` is matched against.
- `deny: invalid_config` → the file has a JSON or schema error.

See [troubleshooting.md](troubleshooting.md) for the full decision/deny-code
reference.

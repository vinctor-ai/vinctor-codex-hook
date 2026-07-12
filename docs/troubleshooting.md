# Troubleshooting

How to read what the hook returned and what to do next. The hook emits a single
JSON object on stdout per `PreToolUse` event — or **nothing at all** when it
abstains. It is intentionally single-line for Codex to parse; to read it by hand,
pipe through `jq`:

```bash
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm publish"}}' \
  | node dist/src/cli.js | jq
```

## The three outcomes

| Outcome | On the wire | Meaning |
|---|---|---|
| permit | **empty stdout, exit 0 after `/v1/enforce` permit** | Mapped, checked by Vinctor, and permitted. Codex runs the tool. |
| `deny`  | `permissionDecision: "deny"` | Either the service denied it (`action_denied`) or the hook **failed closed** (any other code below). Codex blocks the tool. |
| abstain | **empty stdout, exit 0** | The hook could not classify the tool call, so it emits no decision. Codex falls back to its own approval/sandbox flow. **Not** a Vinctor permit. |

Codex does not support an `ask` decision (its `permissionDecision: "ask"` is
"parsed but not supported yet" and fails the hook run), so the unclassifiable case
is expressed as abstaining rather than emitting `ask`.

## Abstain — "could not classify"

An empty decision means neither an operator config rule nor a built-in mapping
matched, so the call never reached the authorization service. To route calls like
this through authorization, add a rule to the hook config (default
`.vinctor/codex-hook.json`) mapping the tool call to an `(action, resource)` pair —
then it routes through `/v1/enforce` and gets a real permit/deny instead of
deferring to Codex. See [configuration.md](configuration.md) for the rule schema.

> Abstain produces **no JSON** (empty stdout, exit 0). Piping a hook run through
> `| jq` on an abstained call will make `jq` error on empty input — that is
> expected, not a hook failure. Use `explain` to see why a call abstains.

## `deny` codes

The reason string is always `Denied by Vinctor authorization: <code>.` — a fixed
template with no further detail by design (see Non-disclosure below). The code
tells you *where* the deny came from:

| Code | Origin | What it means | What to do |
|---|---|---|---|
| `action_denied` | **policy** | The Vinctor service evaluated the mapped `(action, resource)` against the active grant and **denied** it. | A real authorization decision. To see *why*, consult the Vinctor service audit — see below. If it should be permitted, adjust the grant/policy in the service, not the hook. |
| `missing_auth_env` | hook | The call mapped, but one of `VINCTOR_ENDPOINT` / `VINCTOR_AGENT_KEY` / `VINCTOR_GRANT_REF` is unset. | Set all three env vars in the Codex session. |
| `service_unavailable` | hook | `/v1/enforce` returned 5xx, timed out, errored at the network layer, or returned an unexpected status. | Check the endpoint is reachable and healthy. The hook fails closed. |
| `invalid_config` | hook | The config file exists but its JSON or schema is invalid. | Validate `.vinctor/codex-hook.json` against the rule schema. An absent file is fine; only a present-but-broken file denies. Run `vinctor-codex-hook validate <path>` for a field-by-field list. |
| `parse_unsafe` | hook | The Bash command or patch text could not be safely normalized (e.g. an embedded null byte). | Inspect the offending tool input; the hook refuses to guess at unsafe input. |
| `malformed_payload` | hook | The PreToolUse event was not valid JSON, missing a required field, named an unsupported tool, or (for `apply_patch`) carried no patch text. | Usually a matcher/wiring issue — confirm the hook matcher and that the hook is invoked only for supported tools. |

Only `action_denied` is a policy decision. Every other code is the hook **failing
closed** because it could not obtain a decision — none of them mean "the service
said no."

## A mapped call isn't being checked at all

If you expect a deny or audited permit but the tool runs without the hook, confirm
that **Codex actually fired the hook** for that tool. Codex's `PreToolUse` is "a
guardrail rather than a complete enforcement boundary": it fires for `Bash` on
most builds, but on Codex 0.137.0+ the plugin system may affect hook loading —
verify on your installed version. Meanwhile `apply_patch` and most MCP tools have
been unreliable on some builds (openai/codex#16732, #17794). The hook classifies
those surfaces correctly when it is invoked, but it cannot make Codex fire a hook
it doesn't fire. Verify on your installed Codex version and check your matcher.

## Why a denial happened: the service audit

The hook deliberately does **not** put the grant reference, audit event id, matched
scope, or any tool-input content in the reason string (see the design spec §5 and
the invariant ratchet tests). For operator-side debugging of an `action_denied`,
the authoritative record lives in the Vinctor authorization service audit
(`/v1/audit`), not in the hook output. Start there when a permit you expected came
back denied.

## Inspecting the CLI directly

```bash
node dist/src/cli.js --version    # prints the version, exits 0
node dist/src/cli.js --help       # usage: hook mode, env vars, stdin/stdout contract
```

With no flag the CLI reads a PreToolUse event on stdin and writes a decision (or
nothing, when abstaining) on stdout.

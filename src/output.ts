import type { DenyCode, HookError } from "./errors.js";
import type { HookOutput, HookResponse } from "./types.js";

export const DENY_TEMPLATES: Record<DenyCode, string> = {
  malformed_payload: "Denied by Vinctor authorization: malformed_payload.",
  parse_unsafe: "Denied by Vinctor authorization: parse_unsafe.",
  invalid_config: "Denied by Vinctor authorization: invalid_config.",
  missing_auth_env: "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but no Vinctor service is configured (set VINCTOR_ENDPOINT, VINCTOR_AGENT_KEY, and VINCTOR_GRANT_REF). Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Configure the service to get a real allow/deny decision.",
  service_unavailable: "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but the Vinctor service could not be reached. Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Restore the service to get a real allow/deny decision.",
  action_denied: "Denied by Vinctor authorization: action_denied.",
};

export function denyFor(error: HookError): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: DENY_TEMPLATES[error.code],
    },
  };
}

/** Wrap an allow/deny envelope as a serializable hook response. */
export function decision(output: HookOutput): HookResponse {
  return { emit: "decision", output };
}

/**
 * A Vinctor permit continues with empty stdout. Codex reserves
 * `permissionDecision: "allow"` for tool-input rewrites and rejects a bare
 * allow decision, so a successful authorization must not emit an envelope.
 */
export function permit(): HookResponse {
  return { emit: "abstain" };
}

/**
 * Codex does not support an `ask` decision, so an unclassifiable call abstains:
 * the hook writes nothing and exits 0, deferring to Codex's native approval flow.
 */
export function abstain(): HookResponse {
  return { emit: "abstain" };
}

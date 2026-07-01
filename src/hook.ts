import { loadConfig } from "./config.js";
import { enforce, type EnforceEnv } from "./enforce-client.js";
import { HookError, MissingAuthEnvError, ServiceUnavailableError } from "./errors.js";
import { resolve } from "./mapping.js";
import { abstain, allow, decision, denyFor } from "./output.js";
import { parseEvent } from "./parser.js";
import type { HookResponse } from "./types.js";

export type HookDeps = {
  env: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  configPath: string;
};

export async function handleEvent(input: unknown, deps: HookDeps): Promise<HookResponse> {
  let parsed;
  try {
    parsed = parseEvent(input);
  } catch (e) {
    return errorResponse(e);
  }

  let config;
  try {
    config = loadConfig({ path: deps.configPath, env: deps.env });
  } catch (e) {
    return errorResponse(e);
  }

  const mapping = resolve(parsed, config);
  if (mapping.kind === "Unmapped") {
    // Codex has no `ask`; defer to its native approval flow by emitting nothing.
    return abstain();
  }

  // Mapped — now check auth env before calling /v1/enforce.
  const endpoint = deps.env.VINCTOR_ENDPOINT;
  const agentKey = deps.env.VINCTOR_AGENT_KEY;
  const grantRef = deps.env.VINCTOR_GRANT_REF;
  if (!endpoint || !agentKey || !grantRef) {
    return decision(denyFor(new MissingAuthEnvError("required env not set")));
  }
  const env: EnforceEnv = {
    VINCTOR_ENDPOINT: endpoint,
    VINCTOR_AGENT_KEY: agentKey,
    VINCTOR_GRANT_REF: grantRef,
    VINCTOR_BOUNDARY_ID: deps.env.VINCTOR_BOUNDARY_ID,
  };

  try {
    await enforce({ action: mapping.action, resource: mapping.resource }, env, deps.fetchFn);
    return decision(allow());
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown): HookResponse {
  if (e instanceof HookError) return decision(denyFor(e));
  // Anything unexpected becomes service_unavailable rather than crashing the hook.
  return decision(denyFor(new ServiceUnavailableError(String(e))));
}

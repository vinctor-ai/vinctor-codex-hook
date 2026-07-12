import { ActionDeniedError, ServiceUnavailableError } from "./errors.js";
import type { Action } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 500;

export type EnforceEnv = {
  VINCTOR_ENDPOINT: string;
  VINCTOR_AGENT_KEY: string;
  VINCTOR_GRANT_REF: string;
  VINCTOR_BOUNDARY_ID?: string;
};

export type EnforceArgs = { action: Action; resource: string };

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

export async function enforce(
  args: EnforceArgs,
  env: EnforceEnv,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const url = joinUrl(env.VINCTOR_ENDPOINT, "/v1/enforce");
  const body = JSON.stringify({
    grant_ref: env.VINCTOR_GRANT_REF,
    action: args.action,
    resource: args.resource,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Agent-Key": env.VINCTOR_AGENT_KEY,
    };
    if (env.VINCTOR_BOUNDARY_ID) {
      headers["X-Vinctor-Boundary-Id"] = env.VINCTOR_BOUNDARY_ID;
    }
    res = await fetchFn(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (e) {
    throw new ServiceUnavailableError((e as Error).message);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 200) {
    // D-8: a permit is read from the response-body decision, not inferred from
    // the bare HTTP 200. The core always emits {decision:"permit", audit_event_id}
    // on a permit; a 200 that is not a verifiable permit fails closed (throwing
    // ServiceUnavailableError, which the hook maps to a block). We read these
    // fields ONLY to gate the call and never surface their values.
    let permitted = false;
    try {
      const body: unknown = await res.json();
      if (body !== null && typeof body === "object") {
        const b = body as { decision?: unknown; audit_event_id?: unknown };
        permitted =
          b.decision === "permit" &&
          typeof b.audit_event_id === "string" &&
          b.audit_event_id.length > 0;
      }
    } catch {
      // non-JSON / unreadable body → fail closed
    }
    if (permitted) return;
    throw new ServiceUnavailableError("/v1/enforce 200 without a verifiable permit");
  }
  if (res.status === 403) {
    throw new ActionDeniedError(`/v1/enforce 403`);
  }
  throw new ServiceUnavailableError(`/v1/enforce returned ${res.status}`);
}

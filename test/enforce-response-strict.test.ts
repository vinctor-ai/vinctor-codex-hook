import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { enforce } from "../src/enforce-client.js";
import { ServiceUnavailableError } from "../src/errors.js";

const env = {
  VINCTOR_ENDPOINT: "http://vinctor.test/",
  VINCTOR_AGENT_KEY: "aak_test",
  VINCTOR_GRANT_REF: "grt_test",
};
const args = { action: "deploy", resource: "npm/package" } as const;
const on200 = (body: string): typeof fetch =>
  (async () => new Response(body, { status: 200 })) as typeof fetch;

// D-8: a permit must be read from the response-body decision, not inferred from
// the bare HTTP 200. The real core always emits {decision:"permit", audit_event_id}
// on a permit; anything else on a 200 is anomalous and must fail closed.
describe("invariant: /v1/enforce 200 is trusted only when the body is a verifiable permit (D-8)", () => {
  it("allows a 200 whose body is a permit carrying an audit_event_id", async () => {
    const fakeFetch = on200(JSON.stringify({ decision: "permit", audit_event_id: "evt_1" }));
    await assert.doesNotReject(enforce(args, env, fakeFetch));
  });

  it("fails closed on a 200 whose body decision is not permit", async () => {
    const fakeFetch = on200(JSON.stringify({ decision: "deny", audit_event_id: "evt_1" }));
    await assert.rejects(enforce(args, env, fakeFetch), ServiceUnavailableError);
  });

  it("fails closed on a 200 permit missing the audit_event_id", async () => {
    const fakeFetch = on200(JSON.stringify({ decision: "permit" }));
    await assert.rejects(enforce(args, env, fakeFetch), ServiceUnavailableError);
  });

  it("fails closed on a 200 with an empty / non-JSON body", async () => {
    const fakeFetch = on200("");
    await assert.rejects(enforce(args, env, fakeFetch), ServiceUnavailableError);
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { enforce } from "../src/enforce-client.js";

const env = {
  VINCTOR_ENDPOINT: "http://vinctor.test/",
  VINCTOR_AGENT_KEY: "aak_test",
  VINCTOR_GRANT_REF: "grt_NEVER_LEAK_THIS",
};

describe("invariant: /v1/enforce strict body + header hygiene", () => {
  it("request body has exactly {grant_ref, action, resource} — across multiple calls", async () => {
    const captures: Record<string, unknown>[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      captures.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    const inputs = [
      { action: "deploy", resource: "npm/package" },
      { action: "read",   resource: "secret/env" },
      { action: "write",  resource: "ci/workflow" },
    ] as const;
    for (const args of inputs) await enforce(args, env, fakeFetch);
    assert.equal(captures.length, inputs.length);
    for (const body of captures) {
      const keys = Object.keys(body).sort();
      assert.deepEqual(keys, ["action", "grant_ref", "resource"]);
    }
  });

  it("no header contains the grant_ref value (only X-Agent-Key carries auth)", async () => {
    let capturedHeaders = null as Headers | null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = new Headers(init!.headers);
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    await enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch);
    assert.ok(capturedHeaders);
    for (const [, value] of capturedHeaders!.entries()) {
      assert.doesNotMatch(value, /grt_/, `header value leaked grant_ref: ${value}`);
    }
  });
});

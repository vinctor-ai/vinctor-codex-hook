import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { enforce } from "../src/enforce-client.js";
import { ActionDeniedError, ServiceUnavailableError } from "../src/errors.js";

type FetchArgs = { url: string; init: RequestInit };
function mockFetch(args: FetchArgs[], make: () => Response): typeof fetch {
  return async (url, init) => {
    args.push({ url: String(url), init: init ?? {} });
    return make();
  };
}

const env = {
  VINCTOR_ENDPOINT: "http://vinctor.test/",
  VINCTOR_AGENT_KEY: "aak_test",
  VINCTOR_GRANT_REF: "grt_test",
};

describe("enforce client", () => {
  it("sends POST /v1/enforce with X-Agent-Key and the strict body", async () => {
    const calls: FetchArgs[] = [];
    const fakeFetch = mockFetch(calls, () => new Response(JSON.stringify({ decision: "permit", audit_event_id: "evt_test" }), { status: 200 }));
    await enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "http://vinctor.test/v1/enforce");
    assert.equal(calls[0]!.init.method, "POST");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-agent-key"), "aak_test");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      grant_ref: "grt_test", action: "deploy", resource: "npm/package",
    });
  });

  it("sends X-Vinctor-Boundary-Id when VINCTOR_BOUNDARY_ID is set", async () => {
    const calls: FetchArgs[] = [];
    const fakeFetch = mockFetch(calls, () => new Response(JSON.stringify({ decision: "permit", audit_event_id: "evt_test" }), { status: 200 }));
    await enforce(
      { action: "deploy", resource: "npm/package" },
      { ...env, VINCTOR_BOUNDARY_ID: "bnd_codex" },
      fakeFetch,
    );

    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-vinctor-boundary-id"), "bnd_codex");
  });

  it("returns void on 200 permit", async () => {
    const fakeFetch = mockFetch([], () => new Response(JSON.stringify({ decision: "permit", audit_event_id: "evt_test" }), { status: 200 }));
    await assert.doesNotReject(enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch));
  });

  it("throws ActionDeniedError on 403 deny", async () => {
    const fakeFetch = mockFetch([], () => new Response(JSON.stringify({ decision: "deny", error: "action_denied" }), { status: 403 }));
    await assert.rejects(enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch), ActionDeniedError);
  });

  it("throws ServiceUnavailableError on 5xx", async () => {
    const fakeFetch = mockFetch([], () => new Response("oops", { status: 503 }));
    await assert.rejects(enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch), ServiceUnavailableError);
  });

  it("throws ServiceUnavailableError on network error", async () => {
    const fakeFetch: typeof fetch = async () => { throw new Error("ECONNREFUSED"); };
    await assert.rejects(enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch), ServiceUnavailableError);
  });

  it("throws ServiceUnavailableError on unexpected 4xx (e.g., 404 grant_not_found)", async () => {
    const fakeFetch = mockFetch([], () => new Response(JSON.stringify({ error: "grant_not_found" }), { status: 404 }));
    await assert.rejects(enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch), ServiceUnavailableError);
  });

  it("throws ServiceUnavailableError when the request exceeds timeoutMs", async () => {
    // fakeFetch never resolves on its own; aborts via signal.
    const fakeFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }
      });
    await assert.rejects(
      enforce({ action: "deploy", resource: "npm/package" }, env, fakeFetch, /* timeoutMs */ 25),
      ServiceUnavailableError,
    );
  });
});

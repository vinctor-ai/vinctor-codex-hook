import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { handleEvent } from "../src/hook.js";
import type { EnforceEnv } from "../src/enforce-client.js";
import type { HookResponse } from "../src/types.js";

const ENV = {
  VINCTOR_ENDPOINT: "http://vinctor.test/",
  VINCTOR_AGENT_KEY: "aak_test",
  VINCTOR_GRANT_REF: "grt_test",
} satisfies EnforceEnv;

const fetchOK = (): typeof fetch => async () => new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
const fetchDeny = (): typeof fetch => async () => new Response(JSON.stringify({ decision: "deny" }), { status: 403 });
const fetchDown = (): typeof fetch => async () => new Response("down", { status: 503 });

function decisionOf(res: HookResponse): { decision: string; reason?: string } {
  if (res.emit !== "decision") throw new Error(`expected a decision, got ${res.emit}`);
  return {
    decision: res.output.hookSpecificOutput.permissionDecision,
    reason: res.output.hookSpecificOutput.permissionDecisionReason,
  };
}

describe("handleEvent", () => {
  it("Mapped + permit → allow", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env: ENV, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).decision, "allow");
  });
  it("Mapped + boundary id -> forwards X-Vinctor-Boundary-Id", async () => {
    let headerValue: string | null = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      const headers = new Headers(init!.headers);
      headerValue = headers.get("x-vinctor-boundary-id");
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env: { ...ENV, VINCTOR_BOUNDARY_ID: "bnd_codex" }, fetchFn: fakeFetch, configPath: "__missing__" },
    );

    assert.equal(decisionOf(res).decision, "allow");
    assert.equal(headerValue, "bnd_codex");
  });
  it("Mapped + 403 → deny action_denied", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env: ENV, fetchFn: fetchDeny(), configPath: "__missing__" },
    );
    assert.deepEqual(decisionOf(res), { decision: "deny", reason: "Denied by Vinctor authorization: action_denied." });
  });
  it("Mapped + 503 → deny service_unavailable", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env: ENV, fetchFn: fetchDown(), configPath: "__missing__" },
    );
    assert.deepEqual(decisionOf(res), { decision: "deny", reason: "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but the Vinctor service could not be reached. Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Restore the service to get a real allow/deny decision." });
  });

  it("Unmapped → abstain (no stdout); fetch is NOT called and auth env is NOT inspected", async () => {
    let fetchCalls = 0;
    const trackingFetch: typeof fetch = async () => { fetchCalls += 1; return new Response("", { status: 200 }); };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la" } },
      { env: {}, fetchFn: trackingFetch, configPath: "__missing__" },
    );
    assert.equal(res.emit, "abstain");
    assert.equal(fetchCalls, 0);
  });

  it("Mapped but missing VINCTOR_ENDPOINT → deny missing_auth_env", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env: { VINCTOR_AGENT_KEY: "x", VINCTOR_GRANT_REF: "y" }, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).reason, "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but no Vinctor service is configured (set VINCTOR_ENDPOINT, VINCTOR_AGENT_KEY, and VINCTOR_GRANT_REF). Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Configure the service to get a real allow/deny decision.");
  });
  it("malformed event → deny malformed_payload", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse" } as never,
      { env: ENV, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).reason, "Denied by Vinctor authorization: malformed_payload.");
  });
  it("Bash command with null byte → deny parse_unsafe", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "a\0b" } },
      { env: ENV, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).reason, "Denied by Vinctor authorization: parse_unsafe.");
  });
  it("invalid config file → deny invalid_config", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env: ENV, fetchFn: fetchOK(), configPath: "test/fixtures/configs/invalid-version.json" },
    );
    assert.equal(decisionOf(res).reason, "Denied by Vinctor authorization: invalid_config.");
  });
});

describe("handleEvent — apply_patch", () => {
  it("editing .env + permit → allow; body is write:secret/env", async () => {
    let body: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: config/.env\n+X=1\n*** End Patch" } },
      { env: ENV, fetchFn: fakeFetch, configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).decision, "allow");
    assert.deepEqual(body, { grant_ref: "grt_test", action: "write", resource: "secret/env" });
  });

  it("editing an ordinary file → abstain, fetch not called", async () => {
    let calls = 0;
    const trackingFetch: typeof fetch = async () => { calls += 1; return new Response("", { status: 200 }); };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: src/index.ts\n+x\n*** End Patch" } },
      { env: ENV, fetchFn: trackingFetch, configPath: "__missing__" },
    );
    assert.equal(res.emit, "abstain");
    assert.equal(calls, 0);
  });

  it("apply_patch with no patch text → deny malformed_payload", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: {} },
      { env: ENV, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).reason, "Denied by Vinctor authorization: malformed_payload.");
  });
});

describe("handleEvent — WebFetch / WebSearch / file tools", () => {
  it("WebFetch external + permit → allow; body is send:net/external/<host>", async () => {
    let body: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://api.example.com/x?token=abc" } },
      { env: ENV, fetchFn: fakeFetch, configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).decision, "allow");
    assert.deepEqual(body, { grant_ref: "grt_test", action: "send", resource: "net/external/api.example.com" });
  });

  it("WebFetch unparseable URL → deny parse_unsafe", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "not a url" } },
      { env: ENV, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).reason, "Denied by Vinctor authorization: parse_unsafe.");
  });

  it("WebSearch with no rule → abstain, fetch not called", async () => {
    let calls = 0;
    const trackingFetch: typeof fetch = async () => { calls += 1; return new Response("", { status: 200 }); };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "WebSearch", tool_input: { query: "anything" } },
      { env: ENV, fetchFn: trackingFetch, configPath: "__missing__" },
    );
    assert.equal(res.emit, "abstain");
    assert.equal(calls, 0);
  });

  it("Read of .env + permit → allow; body is read:secret/env", async () => {
    let body: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", cwd: "/repo", tool_name: "Read", tool_input: { file_path: ".env" } },
      { env: ENV, fetchFn: fakeFetch, configPath: "__missing__" },
    );
    assert.equal(decisionOf(res).decision, "allow");
    assert.deepEqual(body, { grant_ref: "grt_test", action: "read", resource: "secret/env" });
  });

  it("Write of an ordinary source file → abstain", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", cwd: "/repo", tool_name: "Write", tool_input: { file_path: "src/foo.ts" } },
      { env: ENV, fetchFn: fetchOK(), configPath: "__missing__" },
    );
    assert.equal(res.emit, "abstain");
  });
});

describe("handleEvent — MCP", () => {
  it("unknown server → abstain, fetch not called", async () => {
    let calls = 0;
    const trackingFetch: typeof fetch = async () => { calls += 1; return new Response("", { status: 200 }); };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "mcp__postgres__query", tool_input: { sql: "SELECT 1" } },
      { env: ENV, fetchFn: trackingFetch, configPath: "__missing__" },
    );
    assert.equal(res.emit, "abstain");
    assert.equal(calls, 0);
  });

  it("matching rule (inputField=path) → enforce called with secret/etc", async () => {
    let body: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
    };
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "mcp__filesystem__read_file", tool_input: { path: "/etc/passwd" } },
      { env: ENV, fetchFn: fakeFetch, configPath: "test/fixtures/configs/mcp-rules.json" },
    );
    assert.equal(decisionOf(res).decision, "allow");
    assert.deepEqual(body, { grant_ref: "grt_test", action: "read", resource: "secret/etc" });
  });
});

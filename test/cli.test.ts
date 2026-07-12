import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { runCli } from "../src/cli.js";

const ENV = {
  VINCTOR_ENDPOINT: "http://vinctor.test/",
  VINCTOR_AGENT_KEY: "aak_test",
  VINCTOR_GRANT_REF: "grt_test",
};

describe("CLI hook mode", () => {
  it("invalid JSON on stdin → deny malformed_payload on stdout", async () => {
    let out = "";
    await runCli({
      stdin: "not json",
      stdout: (s) => { out += s; },
      env: ENV,
      configPath: "__missing__",
      fetchFn: async () => new Response("", { status: 200 }),
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, "Denied by Vinctor authorization: malformed_payload.");
  });

  it("mapped + permit → empty stdout so Codex continues", async () => {
    let out = "";
    await runCli({
      stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }),
      stdout: (s) => { out += s; },
      env: ENV,
      configPath: "__missing__",
      fetchFn: async () => new Response(JSON.stringify({ decision: "permit", audit_event_id: "evt_test" }), { status: 200 }),
    });
    assert.equal(out, "");
  });

  it("unmapped event → abstain: stdout is EMPTY (no JSON envelope)", async () => {
    let out = "x";
    out = "";
    await runCli({
      stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la" } }),
      stdout: (s) => { out += s; },
      env: ENV,
      configPath: "__missing__",
      fetchFn: async () => { throw new Error("fetch must not be called"); },
    });
    assert.equal(out, "");
  });

  it("runCli never rejects, even with pathological input", async () => {
    await assert.doesNotReject(runCli({
      stdin: "{{{ not json",
      stdout: () => {},
      env: ENV,
      configPath: "__missing__",
      fetchFn: async () => new Response("", { status: 500 }),
    }));
    await assert.doesNotReject(runCli({
      stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }),
      stdout: () => {},
      env: {},
      configPath: "__missing__",
      fetchFn: async () => { throw new Error("network down"); },
    }));
  });
});

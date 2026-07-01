import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { handleEvent } from "../src/hook.js";
import type { HookResponse } from "../src/types.js";

const ENV_FULL = {
  VINCTOR_ENDPOINT: "http://vinctor.test/",
  VINCTOR_AGENT_KEY: "aak_test",
  VINCTOR_GRANT_REF: "grt_test",
};
const ENV_NO_AUTH = {} as Record<string, string | undefined>;

const fetchPermit: typeof fetch = async () => new Response(JSON.stringify({ decision: "permit" }), { status: 200 });
const fetchDeny: typeof fetch = async () => new Response(JSON.stringify({ decision: "deny" }), { status: 403 });
const fetchDown: typeof fetch = async () => new Response("down", { status: 503 });
const fetchNever: typeof fetch = async () => { throw new Error("fetch should not have been called"); };

// reason text for any response — abstain carries no reason.
function reasonOf(res: HookResponse): string {
  if (res.emit !== "decision") return "";
  return res.output.hookSpecificOutput.permissionDecisionReason ?? "";
}

// Decision matrix across the service-reaching and fail-closed paths.
const matrix = [
  { label: "permit", env: ENV_FULL, fetchFn: fetchPermit },
  { label: "service_deny", env: ENV_FULL, fetchFn: fetchDeny },
  { label: "service_unavailable", env: ENV_FULL, fetchFn: fetchDown },
  { label: "missing_auth_env", env: ENV_NO_AUTH, fetchFn: fetchNever },
];

const CMD_PROBE = "PROBE_CMD_abc123";
const PATCH_PATH_PROBE = "PROBE_PATCH_PATH_def456";
const MCP_PROBE = "PROBE_MCP_FIELD_ghi789";

describe("invariant: no tool_input content disclosure", () => {
  it("Bash command text never appears in any reason across the matrix", async () => {
    for (const { env, fetchFn } of matrix) {
      const res = await handleEvent(
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `npm publish # ${CMD_PROBE}` } },
        { env, fetchFn, configPath: "__missing__" },
      );
      assert.ok(!reasonOf(res).includes(CMD_PROBE), `Bash probe leaked: ${reasonOf(res)}`);
    }
  });

  it("apply_patch target path never appears in any reason across the matrix", async () => {
    for (const { env, fetchFn } of matrix) {
      const res = await handleEvent(
        {
          hook_event_name: "PreToolUse",
          tool_name: "apply_patch",
          tool_input: { input: `*** Begin Patch\n*** Update File: ${PATCH_PATH_PROBE}/.env\n+X=1\n*** End Patch` },
        },
        { env, fetchFn, configPath: "__missing__" },
      );
      assert.ok(!reasonOf(res).includes(PATCH_PATH_PROBE), `patch path leaked: ${reasonOf(res)}`);
    }
  });

  it("apply_patch malformed (no patch text) deny never leaks tool_input", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { junk: PATCH_PATH_PROBE } },
      { env: ENV_FULL, fetchFn: fetchNever, configPath: "__missing__" },
    );
    assert.equal(reasonOf(res), "Denied by Vinctor authorization: malformed_payload.");
    assert.ok(!reasonOf(res).includes(PATCH_PATH_PROBE));
  });

  it("MCP inputField values never appear in any reason (incl. abstain path)", async () => {
    const withAbstain = [...matrix, { label: "abstain", env: ENV_FULL, fetchFn: fetchNever }];
    for (const { env, fetchFn } of withAbstain) {
      const res = await handleEvent(
        { hook_event_name: "PreToolUse", tool_name: "mcp__filesystem__read_file", tool_input: { path: `/etc/${MCP_PROBE}` } },
        { env, fetchFn, configPath: "test/fixtures/configs/mcp-rules.json" },
      );
      assert.ok(!reasonOf(res).includes(MCP_PROBE), `MCP probe leaked: ${reasonOf(res)}`);
    }
  });

  it("WebFetch URL (token in query) never appears in any reason across the matrix", async () => {
    const URL_PROBE = "PROBE_URL_TOKEN_jkl012";
    for (const { env, fetchFn } of matrix) {
      const res = await handleEvent(
        { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: `https://api.example.com/x?token=${URL_PROBE}` } },
        { env, fetchFn, configPath: "__missing__" },
      );
      assert.ok(!reasonOf(res).includes(URL_PROBE), `WebFetch URL probe leaked: ${reasonOf(res)}`);
    }
  });

  it("WebFetch host never appears in any reason across the matrix", async () => {
    const HOST_PROBE = "probe-host-xyz.example.com";
    for (const { env, fetchFn } of matrix) {
      const res = await handleEvent(
        { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: `https://${HOST_PROBE}/p` } },
        { env, fetchFn, configPath: "__missing__" },
      );
      assert.ok(!reasonOf(res).includes(HOST_PROBE), `WebFetch host leaked: ${reasonOf(res)}`);
    }
  });

  it("WebSearch query never appears in any reason (query maps via config → reaches service)", async () => {
    // Prefix "company secret" matches the websearch-rule fixture, so the call maps
    // and exercises the permit/deny/down/missing-auth reason paths with the probe present.
    const Q_PROBE = "company secret PROBE_QUERY_mno345";
    for (const { env, fetchFn } of matrix) {
      const res = await handleEvent(
        { hook_event_name: "PreToolUse", tool_name: "WebSearch", tool_input: { query: Q_PROBE } },
        { env, fetchFn, configPath: "test/fixtures/configs/websearch-rule.json" },
      );
      assert.ok(!reasonOf(res).includes("PROBE_QUERY_mno345"), `WebSearch query leaked: ${reasonOf(res)}`);
    }
  });

  it("unmapped call abstains and emits no reason at all", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `ls ${CMD_PROBE}` } },
      { env: ENV_FULL, fetchFn: fetchNever, configPath: "__missing__" },
    );
    assert.equal(res.emit, "abstain");
    assert.equal(reasonOf(res), "");
  });
});

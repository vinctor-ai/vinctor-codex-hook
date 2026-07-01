import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { handleEvent } from "../src/hook.js";

const endpoint = process.env.VINCTOR_E2E_ENDPOINT;
const agentKey = process.env.VINCTOR_E2E_AGENT_KEY;
const grantRef = process.env.VINCTOR_E2E_GRANT_REF;

const haveEnv = endpoint && agentKey && grantRef;
const env = {
  VINCTOR_ENDPOINT: endpoint,
  VINCTOR_AGENT_KEY: agentKey,
  VINCTOR_GRANT_REF: grantRef,
};

// Exercises the FULL hook path (parse → map → enforce) against a real service.
// A mapped Bash command must reach the service and come back with a real
// decision (allow, or deny:action_denied) — never a fail-closed code, which
// would mean it never reached the service. The grant_ref must not leak.
describe("integration: full hook path wire", { skip: !haveEnv }, () => {
  it("a mapped Bash command reaches the service and gets a real decision", async () => {
    const res = await handleEvent(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } },
      { env, fetchFn: fetch, configPath: "__missing__" },
    );
    assert.equal(res.emit, "decision");
    if (res.emit !== "decision") return;
    const { permissionDecision, permissionDecisionReason } = res.output.hookSpecificOutput;
    const reachedService =
      permissionDecision === "allow" ||
      permissionDecisionReason === "Denied by Vinctor authorization: action_denied.";
    assert.ok(reachedService, `expected allow or action_denied, got ${permissionDecision} / ${permissionDecisionReason}`);
    // Non-disclosure holds on the live path too.
    assert.ok(!JSON.stringify(res.output).includes(grantRef!));
  });
});

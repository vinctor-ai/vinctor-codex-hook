import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

// Smoke tests for issue #1: run the Codex hook CLI against the SHARED mock
// Vinctor /v1/enforce fixture from vinctor-core
// (tools/mock_vinctor_service.py), so all runtime hooks exercise one
// deterministic contract. Self-skips when the mock script or python3 is absent.
//
// Override the mock path with VINCTOR_MOCK_SERVICE; default assumes a sibling
// checkout at ../vinctor-core.

const MOCK_SCRIPT = process.env.VINCTOR_MOCK_SERVICE ?? "../vinctor-core/tools/mock_vinctor_service.py";

function hasPython3(): boolean {
  try { execFileSync("python3", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
const available = existsSync(MOCK_SCRIPT) && hasPython3();
const skip = available ? false : "vinctor-core mock service or python3 not available";

const PORT = 18799;
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const CONFIG = "/tmp/codex-mock-vinctor.json";
let proc: ChildProcess | undefined;

before(async () => {
  if (!available) return;
  // default deny; permit the two scopes our mapped probes produce.
  writeFileSync(CONFIG, JSON.stringify({ default_decision: "deny", permit: ["deploy:pkg/npm/_", "read:secret/env"] }));
  proc = spawn("python3", [MOCK_SCRIPT, "--port", String(PORT), "--config", CONFIG], { stdio: "ignore" });
  // Poll readiness: the mock answers POST /v1/enforce once listening.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${ENDPOINT}/v1/enforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Agent-Key": "aak_mock" },
        body: JSON.stringify({ grant_ref: "grt_mock", action: "read", resource: "ping" }),
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(() => { proc?.kill(); });

type Decision = { decision: string; reason?: string };
function runCli(event: unknown, extraEnv: Record<string, string> = {}): Decision {
  const env = {
    ...process.env,
    VINCTOR_ENDPOINT: ENDPOINT,
    VINCTOR_AGENT_KEY: "aak_mock",
    VINCTOR_GRANT_REF: "grt_mock",
    ...extraEnv,
  };
  const out = execFileSync("node", ["dist/src/cli.js"], { input: JSON.stringify(event), env }).toString();
  if (out.trim() === "") return { decision: "abstain" };
  const o = JSON.parse(out);
  return { decision: o.hookSpecificOutput.permissionDecision, reason: o.hookSpecificOutput.permissionDecisionReason };
}
const bash = (command: string) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

describe("mock-service smoke (shared vinctor-core fixture)", { skip }, () => {
  it("permit response allows a mapped action (npm publish → deploy:pkg/npm/_)", () => {
    assert.equal(runCli(bash("npm publish")).decision, "abstain");
  });

  it("deny response blocks a mapped action (git force-push → default deny)", () => {
    assert.equal(runCli(bash("git push --force origin main")).reason, "Denied by Vinctor authorization: action_denied.");
  });

  it("invalid X-Agent-Key fails closed (mock 401 → service_unavailable)", () => {
    assert.equal(runCli(bash("npm publish"), { VINCTOR_AGENT_KEY: "aak_WRONG" }).reason, "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but the Vinctor service could not be reached. Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Restore the service to get a real allow/deny decision.");
  });

  it("missing X-Agent-Key fails closed before the wire (missing_auth_env)", () => {
    // Drop the key entirely: the hook's own guard fires before any request.
    const env = { ...process.env, VINCTOR_ENDPOINT: ENDPOINT, VINCTOR_GRANT_REF: "grt_mock" };
    delete (env as Record<string, string | undefined>).VINCTOR_AGENT_KEY;
    const out = execFileSync("node", ["dist/src/cli.js"], { input: JSON.stringify(bash("npm publish")), env }).toString();
    assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but no Vinctor service is configured (set VINCTOR_ENDPOINT, VINCTOR_AGENT_KEY, and VINCTOR_GRANT_REF). Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Configure the service to get a real allow/deny decision.");
  });

  it("strict body is accepted by the mock (only grant_ref/action/resource) — permit succeeds", () => {
    // The mock 400s on extra/missing body fields. A permit therefore proves the
    // hook sent exactly the strict body. (Exact body shape is also unit-asserted
    // in test/enforce-body-strict.test.ts.)
    assert.equal(runCli(bash("npm publish")).decision, "abstain");
  });

  it("optional X-Vinctor-Boundary-Id is forwarded as a header, not in the strict body", () => {
    // With the boundary id set, permit still succeeds — it travels as
    // X-Vinctor-Boundary-Id (the mock would 400 if it leaked into the body). The
    // exact header value is unit-asserted in test/enforce-client.test.ts.
    assert.equal(runCli(bash("npm publish"), { VINCTOR_BOUNDARY_ID: "bnd_codex" }).decision, "abstain");
  });

  it("unreachable endpoint fails closed (service_unavailable)", () => {
    assert.equal(runCli(bash("npm publish"), { VINCTOR_ENDPOINT: "http://127.0.0.1:1" }).reason, "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but the Vinctor service could not be reached. Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Restore the service to get a real allow/deny decision.");
  });

  it("unmapped call never contacts the service (abstain, no raw payload sent)", () => {
    assert.equal(runCli(bash("ls -la")).decision, "abstain");
  });
});

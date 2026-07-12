import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { handleEvent } from "../src/hook.js";

// A self-contained, service-backed end-to-end test. Unlike enforce-wire /
// hook-wire (which hit a REAL Vinctor service and skip without VINCTOR_E2E_*),
// this spins up a local mock /v1/enforce in-process and drives the FULL hook
// path (parse → map → enforce → decide) against it. It always runs.
//
// handleEvent's fetch is async, so the event loop stays free for the in-process
// server to respond while handleEvent awaits — no cross-process blocking.

const GRANT = "grt_LOCAL_E2E_secret";
const ENV_BASE = { VINCTOR_AGENT_KEY: "aak_local", VINCTOR_GRANT_REF: GRANT };

// The mock service permits resource "npm/package", denies everything else, and
// can be flipped to simulate a 5xx outage. It also captures the last request so
// the strict-body / header invariants can be asserted on the live path.
let server: Server;
let endpoint = "";
let mode: "normal" | "outage" = "normal";
let lastBody: Record<string, unknown> | null = null;
let lastAuthHeader: string | null = null;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastAuthHeader = req.headers["x-agent-key"] as string | undefined ?? null;
      lastBody = JSON.parse(raw);
      if (mode === "outage") {
        res.writeHead(503).end(JSON.stringify({ error: "service_unavailable" }));
        return;
      }
      if ((lastBody as { resource?: string }).resource === "npm/package") {
        // D-8: the hook verifies a permit from the body (decision + non-empty
        // audit_event_id), so the mock must emit a verifiable permit.
        res.writeHead(200).end(JSON.stringify({ decision: "permit", audit_event_id: "evt_test" }));
      } else {
        res.writeHead(403).end(JSON.stringify({ decision: "deny", error: "action_denied" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  endpoint = `http://127.0.0.1:${port}`;
});

after(() => { server.close(); });

const env = () => ({ ...ENV_BASE, VINCTOR_ENDPOINT: endpoint });
const bash = (command: string) =>
  ({ hook_event_name: "PreToolUse" as const, tool_name: "Bash", tool_input: { command } });

describe("service-backed E2E (local mock /v1/enforce)", () => {
  it("permit path: mapped + in-scope → empty stdout continuation", async () => {
    mode = "normal";
    const res = await handleEvent(bash("npm publish"), { env: env(), fetchFn: fetch, configPath: "__missing__" });
    assert.equal(res.emit, "abstain");
  });

  it("strict enforce body + X-Agent-Key header on the live path", () => {
    assert.deepEqual(Object.keys(lastBody!).sort(), ["action", "grant_ref", "resource"]);
    assert.equal((lastBody as { action: string }).action, "deploy");
    assert.equal((lastBody as { resource: string }).resource, "npm/package");
    assert.equal(lastAuthHeader, "aak_local");
  });

  it("deny path: mapped + out-of-scope → deny action_denied", async () => {
    mode = "normal";
    // git force-push maps to git/push-force, which the mock denies (403).
    const res = await handleEvent(bash("git push --force origin main"), { env: env(), fetchFn: fetch, configPath: "__missing__" });
    if (res.emit !== "decision") throw new Error("expected decision");
    assert.equal(res.output.hookSpecificOutput.permissionDecisionReason, "Denied by Vinctor authorization: action_denied.");
  });

  it("fail-closed: service outage → deny service_unavailable", async () => {
    mode = "outage";
    const res = await handleEvent(bash("npm publish"), { env: env(), fetchFn: fetch, configPath: "__missing__" });
    if (res.emit !== "decision") throw new Error("expected decision");
    assert.equal(res.output.hookSpecificOutput.permissionDecisionReason, "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but the Vinctor service could not be reached. Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Restore the service to get a real allow/deny decision.");
  });

  it("abstain: unmapped call never reaches the service", async () => {
    mode = "normal";
    lastBody = null;
    const res = await handleEvent(bash("ls -la"), { env: env(), fetchFn: fetch, configPath: "__missing__" });
    assert.equal(res.emit, "abstain");
    assert.equal(lastBody, null); // no request was made
  });

  it("missing auth env: mapped but env incomplete → deny missing_auth_env (no request)", async () => {
    mode = "normal";
    lastBody = null;
    const res = await handleEvent(bash("npm publish"), {
      env: { VINCTOR_ENDPOINT: endpoint }, fetchFn: fetch, configPath: "__missing__",
    });
    if (res.emit !== "decision") throw new Error("expected decision");
    assert.equal(res.output.hookSpecificOutput.permissionDecisionReason, "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but no Vinctor service is configured (set VINCTOR_ENDPOINT, VINCTOR_AGENT_KEY, and VINCTOR_GRANT_REF). Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Configure the service to get a real allow/deny decision.");
    assert.equal(lastBody, null);
  });

  it("non-disclosure on the live path: grant_ref never appears in output", async () => {
    mode = "normal";
    for (const cmd of ["npm publish", "git push --force"]) {
      const res = await handleEvent(bash(cmd), { env: env(), fetchFn: fetch, configPath: "__missing__" });
      assert.ok(!JSON.stringify(res).includes(GRANT), `grant_ref leaked for "${cmd}"`);
    }
  });
});

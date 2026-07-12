import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { runDoctor, type DoctorInput } from "../../src/commands/doctor.js";

// A fully-healthy input: correct node, matching versions, a config that wires
// this hook with the documented matcher, all VINCTOR_* env set, endpoint reachable.
const GOOD_CONFIG = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash|apply_patch|Edit|Write|mcp__.*",
        hooks: [{ type: "command", command: "vinctor-codex-hook" }],
      },
    ],
  },
});

function input(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    binPath: "/usr/local/bin/vinctor-codex-hook",
    nodeVersion: "v20.11.0",
    packageVersion: "0.1.1",
    manifestVersion: "0.1.1",
    env: {
      VINCTOR_ENDPOINT: "http://127.0.0.1:8765",
      VINCTOR_AGENT_KEY: "aak_secret",
      VINCTOR_GRANT_REF: "grt_secret",
    },
    configCandidates: [{ path: "/home/u/.codex/hooks.json", raw: GOOD_CONFIG }],
    endpointReachable: true,
    ...over,
  };
}

const byName = (r: ReturnType<typeof runDoctor>, name: string) =>
  r.checks.find((c) => c.name === name)!;

describe("runDoctor", () => {
  test("all-healthy input passes every check and ok=true", () => {
    const r = runDoctor(input());
    assert.equal(r.ok, true);
    assert.ok(r.checks.every((c) => c.status !== "fail"));
    assert.equal(byName(r, "node-version").status, "pass");
    assert.equal(byName(r, "version-parity").status, "pass");
    assert.equal(byName(r, "hook-config").status, "pass");
    assert.equal(byName(r, "vinctor-env").status, "pass");
    assert.equal(byName(r, "classifier-smoke").status, "pass");
  });

  test("classifier smoke maps npm publish to deploy:npm/package", () => {
    const smoke = byName(runDoctor(input()), "classifier-smoke");
    assert.equal(smoke.status, "pass");
    assert.match(smoke.detail, /deploy.*npm\/package/);
  });

  test("resolved bin path is surfaced for pasting into hooks.json", () => {
    const cli = byName(runDoctor(input()), "cli-resolved");
    assert.equal(cli.status, "pass");
    assert.match(cli.detail, /\/usr\/local\/bin\/vinctor-codex-hook/);
  });

  test("version skew between package and plugin manifest FAILS (regression)", () => {
    const r = runDoctor(input({ manifestVersion: "0.1.0" }));
    assert.equal(r.ok, false);
    assert.equal(byName(r, "version-parity").status, "fail");
  });

  test("node < 20 fails", () => {
    const r = runDoctor(input({ nodeVersion: "v18.19.0" }));
    assert.equal(r.ok, false);
    assert.equal(byName(r, "node-version").status, "fail");
  });

  test("missing VINCTOR_* env warns (fail-closed until set) but does not fail", () => {
    const r = runDoctor(input({ env: { VINCTOR_ENDPOINT: "http://x" } }));
    const env = byName(r, "vinctor-env");
    assert.equal(env.status, "warn");
    assert.equal(r.ok, true); // warnings don't fail the exit code
  });

  test("env values are never echoed (redaction)", () => {
    const r = runDoctor(input());
    assert.ok(!JSON.stringify(r).includes("aak_secret"));
    assert.ok(!JSON.stringify(r).includes("grt_secret"));
  });

  test("no config referencing the hook warns (plugin/config.toml path unknown), not fail", () => {
    const r = runDoctor(input({ configCandidates: [{ path: "/home/u/.codex/hooks.json", raw: null }] }));
    assert.equal(byName(r, "hook-config").status, "warn");
    assert.equal(r.ok, true);
  });

  test("over-broad matcher .* warns (fail-closes unknown tools)", () => {
    const cfg = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: "vinctor-codex-hook" }] }] },
    });
    const w = byName(runDoctor(input({ configCandidates: [{ path: "/h/.codex/hooks.json", raw: cfg }] })), "hook-config");
    assert.equal(w.status, "warn");
    assert.match(w.detail, /\.\*/);
  });

  test("endpoint set but unreachable warns", () => {
    const s = byName(runDoctor(input({ endpointReachable: false })), "service-reachable");
    assert.equal(s.status, "warn");
  });

  test("report carries the honest caveat that Codex trust/firing cannot be proven here", () => {
    const r = runDoctor(input());
    assert.match(r.caveat, /\/hooks|trust|firing|interactive/i);
  });
});

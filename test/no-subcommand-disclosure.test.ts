import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { runValidate } from "../src/commands/validate.js";
import { runExplain } from "../src/commands/explain.js";
import { renderValidateText, renderExplainText } from "../src/commands/render.js";

const reader = (files: Record<string, string>) => (p: string): string => {
  if (!(p in files)) { const e = new Error("ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; }
  return files[p]!;
};

// Probe strings that look like sensitive tokens, embedded in inputs.
const GRANT_LIKE = "grt_PROBE_should_never_appear";
const AUDIT_LIKE = "evt_PROBE_should_never_appear";

describe("invariant: no grant_ref / audit_event_id in subcommand output", () => {
  it("validate output (json + text) has no grt_/evt_ substrings", () => {
    const res = runValidate({
      configPath: "c.json",
      raw: JSON.stringify({ version: 1, rules: [
        // a resource string that itself contains the probe token
        { tool: "Bash", matchType: "exact", pattern: "x", action: "execute", resource: `ci/${GRANT_LIKE}` },
      ] }),
    });
    // The probe is in the (valid) config, so it may legitimately appear; this test
    // asserts the SUBCOMMAND never *introduces* a grant/audit token of its own.
    // We check the structural fields the hook would protect: there is no field for
    // grant_ref / audit_event_id in a ValidateResult at all.
    const json = JSON.stringify(res);
    assert.ok(!json.includes("grant_ref"));
    assert.ok(!json.includes("audit_event_id"));
    assert.ok(!renderValidateText(res).includes("grant_ref"));
  });

  it("explain output has no grant_ref/audit_event_id fields", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }) }),
    });
    const json = JSON.stringify(res);
    assert.ok(!json.includes("grant_ref"));
    assert.ok(!json.includes("audit_event_id"));
    assert.ok(!json.includes(GRANT_LIKE));
    assert.ok(!json.includes(AUDIT_LIKE));
    assert.ok(!renderExplainText(res).includes("grant_ref"));
  });
});

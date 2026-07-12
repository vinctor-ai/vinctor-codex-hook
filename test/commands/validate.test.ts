import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { runValidate } from "../../src/commands/validate.js";

describe("runValidate", () => {
  it("absent config (raw null) → ok with built-ins-only note", () => {
    const res = runValidate({ configPath: ".vinctor/codex-hook.json", raw: null });
    assert.equal(res.ok, true);
    assert.equal(res.ruleCount, 0);
    assert.match(res.note ?? "", /built-in defaults only/);
  });

  it("valid config → ok with rule count", () => {
    const res = runValidate({
      configPath: "c.json",
      raw: JSON.stringify({ version: 1, rules: [
        { tool: "apply_patch", matchType: "glob", pattern: "**/*.tf", action: "write", resource: "infra/tf" },
      ] }),
    });
    assert.equal(res.ok, true);
    assert.equal(res.ruleCount, 1);
    assert.deepEqual(res.errors, []);
  });

  it("invalid config → collects all errors", () => {
    const res = runValidate({
      configPath: "c.json",
      raw: JSON.stringify({ version: 1, rules: [
        { tool: "Bash", matchType: "exact", pattern: "x", action: "yell", resource: "y" },
        { tool: "Glob", matchType: "glob", pattern: "x", action: "read", resource: "ci/x" },
      ] }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.errors.length, 2);
  });

  it("malformed JSON → one top-level error", () => {
    const res = runValidate({ configPath: "c.json", raw: "{ not json" });
    assert.equal(res.ok, false);
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0]!.ruleIndex, null);
  });

  it("result is tagged command=validate and echoes the configPath", () => {
    const res = runValidate({ configPath: "abc.json", raw: null });
    assert.equal(res.command, "validate");
    assert.equal(res.configPath, "abc.json");
  });
});

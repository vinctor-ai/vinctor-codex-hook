import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { loadConfig, collectConfigErrors } from "../src/config.js";
import { InvalidConfigError } from "../src/errors.js";

describe("config loader", () => {
  it("returns empty rule set when file is absent", () => {
    assert.deepEqual(loadConfig({ path: "test/fixtures/configs/__missing__.json", env: {} }), { version: 1, rules: [] });
  });

  it("loads a valid config file (Bash + apply_patch rules)", () => {
    const cfg = loadConfig({ path: "test/fixtures/configs/valid.json", env: {} });
    assert.equal(cfg.version, 1);
    assert.equal(cfg.rules.length, 2);
    assert.equal(cfg.rules[0]!.tool, "Bash");
    assert.equal(cfg.rules[1]!.tool, "apply_patch");
  });

  it("rejects unsupported version", () => {
    assert.throws(() => loadConfig({ path: "test/fixtures/configs/invalid-version.json", env: {} }), InvalidConfigError);
  });

  it("rejects an unknown tool name (e.g. Glob)", () => {
    assert.throws(() => loadConfig({ path: "test/fixtures/configs/invalid-rule.json", env: {} }), InvalidConfigError);
  });

  it("env override (VINCTOR_CODEX_HOOK_CONFIG) takes precedence over default path", () => {
    const cfg = loadConfig({
      path: ".vinctor/codex-hook.json",
      env: { VINCTOR_CODEX_HOOK_CONFIG: "test/fixtures/configs/valid.json" },
    });
    assert.equal(cfg.rules.length, 2);
  });

  it("loads a WebFetch override config", () => {
    const cfg = loadConfig({ path: "test/fixtures/configs/webfetch-override.json", env: {} });
    assert.equal(cfg.rules[0]!.tool, "WebFetch");
    assert.equal(cfg.rules[0]!.action, "read");
  });

  it("loads a WebSearch rule", () => {
    const cfg = loadConfig({ path: "test/fixtures/configs/websearch-rule.json", env: {} });
    assert.equal(cfg.rules[0]!.tool, "WebSearch");
  });

  it("loads MCP rules with inputField", () => {
    const cfg = loadConfig({ path: "test/fixtures/configs/mcp-rules.json", env: {} });
    assert.equal(cfg.rules.length, 2);
    assert.equal(cfg.rules[1]!.tool, "mcp__filesystem__read_file");
    assert.equal(cfg.rules[1]!.inputField, "path");
  });

  it("accepts an MCP rule whose server name contains an underscore (regression)", () => {
    const cfg = loadConfig({ path: "test/fixtures/configs/mcp-underscore-server.json", env: {} });
    assert.equal(cfg.rules[0]!.tool, "mcp__notion_internal__create_page");
  });

  it("rejects MCP tool name with empty server segment", () => {
    assert.throws(() => loadConfig({ path: "test/fixtures/configs/invalid-mcp-empty-server.json", env: {} }), InvalidConfigError);
  });
  it("rejects MCP tool name with empty tool segment", () => {
    assert.throws(() => loadConfig({ path: "test/fixtures/configs/invalid-mcp-empty-tool.json", env: {} }), InvalidConfigError);
  });
  it("rejects inputField with characters outside [A-Za-z0-9_]", () => {
    assert.throws(() => loadConfig({ path: "test/fixtures/configs/invalid-input-field-bad-char.json", env: {} }), InvalidConfigError);
  });
  it("rejects empty inputField", () => {
    assert.throws(() => loadConfig({ path: "test/fixtures/configs/invalid-input-field-empty.json", env: {} }), InvalidConfigError);
  });
});

describe("collectConfigErrors (collect-all)", () => {
  it("empty array for a valid config", () => {
    assert.deepEqual(collectConfigErrors({
      version: 1,
      rules: [{ tool: "Bash", matchType: "exact", pattern: "npm test", action: "execute", resource: "ci/test" }],
    }), []);
  });

  it("accepts Bash, apply_patch, file tools, Web tools, and MCP as valid tools", () => {
    for (const tool of ["Bash", "apply_patch", "Read", "Write", "Edit", "MultiEdit", "WebFetch", "WebSearch", "mcp__x__y"]) {
      assert.deepEqual(
        collectConfigErrors({ version: 1, rules: [{ tool, matchType: "glob", pattern: "*", action: "read", resource: "r" }] }),
        [], `tool ${tool} should be valid`,
      );
    }
  });

  it("collects multiple errors across rules in one pass", () => {
    const errs = collectConfigErrors({
      version: 1,
      rules: [
        { tool: "Bash", matchType: "exact", pattern: "ok", action: "execute", resource: "ci/test" },
        { tool: "Bash", matchType: "exact", pattern: "x", action: "yell", resource: "y" },
        { tool: "Glob", matchType: "glob", pattern: "x", action: "read", resource: "ci/x" },
        { tool: "mcp__x__y", matchType: "exact", pattern: "x", inputField: "bad field", action: "read", resource: "z" },
      ],
    });
    const fields = errs.map((e) => `${e.ruleIndex}.${e.field}`);
    assert.ok(fields.includes("1.action"));   // bad verb
    assert.ok(fields.includes("2.tool"));      // Glob is not a recognized tool
    assert.ok(fields.includes("3.inputField")); // space in inputField
    assert.equal(errs.length, 3);
  });

  it("reports top-level version error with ruleIndex null", () => {
    assert.deepEqual(collectConfigErrors({ version: 2, rules: [] }), [
      { ruleIndex: null, field: "version", message: "unsupported config version: 2 (must be 1)" },
    ]);
  });
});

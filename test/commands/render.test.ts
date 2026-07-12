import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { renderValidateText, renderExplainText } from "../../src/commands/render.js";
import type { ExplainResult, ValidateResult } from "../../src/types.js";

describe("renderValidateText", () => {
  it("valid → a ✓ line with the rule count", () => {
    const res: ValidateResult = { command: "validate", configPath: "c.json", ok: true, ruleCount: 3, errors: [] };
    const out = renderValidateText(res);
    assert.match(out, /✓/);
    assert.match(out, /3 rule/);
  });

  it("absent → shows the note", () => {
    const res: ValidateResult = { command: "validate", configPath: "c.json", ok: true, ruleCount: 0, errors: [], note: "no config file; built-in defaults only" };
    assert.match(renderValidateText(res), /built-in defaults only/);
  });

  it("invalid → one line per error with rule index and field", () => {
    const res: ValidateResult = {
      command: "validate", configPath: "c.json", ok: false, ruleCount: 2,
      errors: [
        { ruleIndex: 0, field: "action", message: "rules[0].action invalid: yell" },
        { ruleIndex: 1, field: "resource", message: "rules[1].resource may not contain wildcards" },
      ],
    };
    const out = renderValidateText(res);
    assert.match(out, /✗/);
    assert.match(out, /rules\[0\]\.action/);
    assert.match(out, /rules\[1\]\.resource/);
  });
});

describe("renderExplainText", () => {
  it("mapped → shows tool, decision, action, resource, source", () => {
    const res: ExplainResult = { command: "explain", tool: "apply_patch", matchInput: "write config/.env", decision: "mapped", action: "write", resource: "secret/env", source: "defaults", rule: null };
    const out = renderExplainText(res);
    assert.match(out, /apply_patch/);
    assert.match(out, /write/);
    assert.match(out, /secret\/env/);
    assert.match(out, /defaults/);
  });

  it("unmapped → says unmapped and mentions abstain", () => {
    const res: ExplainResult = { command: "explain", tool: "Bash", matchInput: "ls", decision: "unmapped", action: null, resource: null, source: null, rule: null };
    const out = renderExplainText(res);
    assert.match(out, /UNMAPPED/);
    assert.match(out, /abstains/);
  });

  it("mapped WebFetch → appends a Codex-firing version-dependence note", () => {
    const res: ExplainResult = { command: "explain", tool: "WebFetch", matchInput: "api.example.com", decision: "mapped", action: "send", resource: "net/external/api.example.com", source: "defaults", rule: null };
    const out = renderExplainText(res);
    assert.match(out, /version-dependent/);
    assert.match(out, /if Codex fires the hook/);
  });

  it("mapped Bash → no firing note (Bash fires reliably)", () => {
    const res: ExplainResult = { command: "explain", tool: "Bash", matchInput: "npm publish", decision: "mapped", action: "deploy", resource: "npm/package", source: "classifier", rule: null };
    assert.doesNotMatch(renderExplainText(res), /version-dependent/);
  });

  it("parse_error → shows the code", () => {
    const res: ExplainResult = { command: "explain", decision: "parse_error", errorCode: "parse_unsafe", message: "null byte" };
    assert.match(renderExplainText(res), /parse_unsafe/);
  });

  it("config_error → lists config errors", () => {
    const res: ExplainResult = { command: "explain", decision: "config_error", configPath: "c.json", errors: [{ ruleIndex: 0, field: "action", message: "bad" }] };
    assert.match(renderExplainText(res), /config/i);
  });
});

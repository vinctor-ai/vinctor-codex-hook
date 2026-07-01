import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { runExplain } from "../../src/commands/explain.js";

function reader(files: Record<string, string>) {
  return (path: string): string => {
    if (!(path in files)) {
      const e = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    }
    return files[path]!;
  };
}

const event = (o: unknown) => JSON.stringify(o);

describe("runExplain", () => {
  it("Bash npm publish → mapped via classifier", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish --tag beta" } }) }),
    });
    if (res.decision !== "mapped") throw new Error("unreachable");
    assert.equal(res.action, "deploy");
    assert.equal(res.resource, "npm/package");
    assert.equal(res.source, "classifier");
    assert.equal(res.matchInput, "npm publish --tag beta");
    assert.equal(res.rule, null);
  });

  it("apply_patch editing .env → mapped via defaults (write:secret/env)", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: config/.env\n+A=1\n*** End Patch" } }) }),
    });
    if (res.decision !== "mapped") throw new Error("unreachable");
    assert.equal(res.action, "write");
    assert.equal(res.resource, "secret/env");
    assert.equal(res.source, "defaults");
    assert.equal(res.matchInput, "write config/.env");
  });

  it("apply_patch config rule wins → mapped via config with the rule echoed", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "c.json",
      env: {},
      readFile: reader({
        "e.json": event({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: db/migrations/001.sql\n+x\n*** End Patch" } }),
        "c.json": JSON.stringify({ version: 1, rules: [
          { tool: "apply_patch", matchType: "glob", pattern: "**/migrations/**", action: "deploy", resource: "db/migration" },
        ] }),
      }),
    });
    if (res.decision !== "mapped") throw new Error("unreachable");
    assert.equal(res.source, "config");
    assert.equal(res.resource, "db/migration");
    assert.equal(res.rule?.pattern, "**/migrations/**");
  });

  it("unmapped → decision unmapped, nulls; matchInput is the op summary", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: src/x.ts\n+y\n*** End Patch" } }) }),
    });
    if (res.decision !== "unmapped") throw new Error("unreachable");
    assert.equal(res.action, null);
    assert.equal(res.matchInput, "write src/x.ts");
  });

  it("malformed event → parse_error", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse" }) }),
    });
    if (res.decision !== "parse_error") throw new Error("unreachable");
    assert.equal(res.errorCode, "malformed_payload");
  });

  it("null byte in Bash command → parse_error parse_unsafe", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat\0.env" } }) }),
    });
    if (res.decision !== "parse_error") throw new Error("unreachable");
    assert.equal(res.errorCode, "parse_unsafe");
  });

  it("Bash config rule wins among multiple matches → most specific", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "c.json",
      env: {},
      readFile: reader({
        "e.json": event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish --tag beta" } }),
        "c.json": JSON.stringify({ version: 1, rules: [
          { tool: "Bash", matchType: "prefix", pattern: "npm publish", action: "deploy", resource: "broad/npm" },
          { tool: "Bash", matchType: "exact", pattern: "npm publish --tag beta", action: "deploy", resource: "specific/npm" },
        ] }),
      }),
    });
    if (res.decision !== "mapped") throw new Error("unreachable");
    assert.equal(res.resource, "specific/npm");
    assert.equal(res.rule?.matchType, "exact");
  });

  it("MCP event without inputField → matchInput is the tool name", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse", tool_name: "mcp__notion__create_page", tool_input: { title: "x" } }) }),
    });
    if (res.decision !== "unmapped") throw new Error("unreachable");
    assert.equal(res.matchInput, "mcp__notion__create_page");
  });

  it("invalid config → config_error with errors", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "c.json",
      env: {},
      readFile: reader({
        "e.json": event({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }),
        "c.json": JSON.stringify({ version: 1, rules: [{ tool: "Bash", matchType: "exact", pattern: "x", action: "yell", resource: "y" }] }),
      }),
    });
    if (res.decision !== "config_error") throw new Error("unreachable");
    assert.ok(res.errors.length >= 1);
  });

  it("WebFetch → mapped via defaults; matchInput is the host", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "e.json": event({ hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://user:pass@api.example.com/v1?token=x" } }) }),
    });
    if (res.decision !== "mapped") throw new Error("unreachable");
    assert.equal(res.matchInput, "api.example.com");
    assert.equal(res.resource, "net/external/api.example.com");
    assert.equal(res.source, "defaults");
  });

  it("WebSearch with matching config rule → mapped via config", () => {
    const res = runExplain({
      eventPath: "e.json",
      configPath: "c.json",
      env: {},
      readFile: reader({
        "e.json": event({ hook_event_name: "PreToolUse", tool_name: "WebSearch", tool_input: { query: "salary bands" } }),
        "c.json": JSON.stringify({ version: 1, rules: [{ tool: "WebSearch", matchType: "prefix", pattern: "salary", action: "send", resource: "web/search/sensitive" }] }),
      }),
    });
    if (res.decision !== "mapped") throw new Error("unreachable");
    assert.equal(res.source, "config");
    assert.equal(res.resource, "web/search/sensitive");
    assert.equal(res.rule?.pattern, "salary");
  });

  it("file tool matchInput is the normalized path", () => {
    const res = runExplain({
      eventPath: "f.json",
      configPath: "__none__",
      env: {},
      readFile: reader({ "f.json": event({ hook_event_name: "PreToolUse", cwd: "/repo", tool_name: "Read", tool_input: { file_path: "./.env" } }) }),
    });
    if (res.decision === "parse_error" || res.decision === "config_error") throw new Error("unreachable");
    assert.equal(res.matchInput, "repo/.env");
  });

  it("event file missing → throws (caller error, CLI maps to exit 2)", () => {
    assert.throws(
      () => runExplain({ eventPath: "missing.json", configPath: "__none__", env: {}, readFile: reader({}) }),
      /ENOENT/,
    );
  });
});

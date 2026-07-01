import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseEvent } from "../src/parser.js";
import { MalformedPayloadError, ParseUnsafeError } from "../src/errors.js";

const FIX = "test/fixtures/events";
const load = (name: string) => JSON.parse(readFileSync(`${FIX}/${name}`, "utf8"));

describe("parser — Bash", () => {
  it("trims and collapses whitespace, records first token; ignores Codex model/turn_id", () => {
    const parsed = parseEvent(load("bash-npm-publish.json"));
    assert.equal(parsed.tool, "Bash");
    if (parsed.tool !== "Bash") throw new Error("unreachable");
    assert.equal(parsed.rawCommand, "  npm   publish   --tag beta  ");
    assert.equal(parsed.normalizedCommand, "npm publish --tag beta");
    assert.equal(parsed.firstToken, "npm");
  });

  it("throws ParseUnsafeError on null byte", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm\0publish" } }),
      ParseUnsafeError,
    );
  });

  it("empty command after normalization is MalformedPayloadError", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "   " } }),
      MalformedPayloadError,
    );
  });
});

describe("parser — apply_patch", () => {
  it("extracts a write op from an Update File envelope", () => {
    const parsed = parseEvent(load("apply-patch-env.json"));
    assert.equal(parsed.tool, "apply_patch");
    if (parsed.tool !== "apply_patch") throw new Error("unreachable");
    assert.equal(parsed.ops.length, 1);
    assert.deepEqual(parsed.ops[0], { action: "write", rawPath: "config/.env", normalizedPath: "config/.env" });
  });

  it("extracts multiple ops with mixed actions", () => {
    const parsed = parseEvent(load("apply-patch-multi.json"));
    if (parsed.tool !== "apply_patch") throw new Error("unreachable");
    assert.equal(parsed.ops.length, 2);
    assert.equal(parsed.ops[0]!.action, "write");
    assert.equal(parsed.ops[1]!.action, "delete");
    assert.equal(parsed.ops[1]!.normalizedPath, ".github/workflows/ci.yml");
  });

  it("reads the patch text from tool_input.patch fallback", () => {
    const parsed = parseEvent({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { patch: "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch" },
    });
    if (parsed.tool !== "apply_patch") throw new Error("unreachable");
    assert.deepEqual(parsed.ops[0], { action: "write", rawPath: "a.txt", normalizedPath: "a.txt" });
  });

  it("a patch with no file-op header yields zero ops (caller abstains)", () => {
    const parsed = parseEvent({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { input: "no markers here" },
    });
    if (parsed.tool !== "apply_patch") throw new Error("unreachable");
    assert.equal(parsed.ops.length, 0);
  });

  it("missing patch text is MalformedPayloadError (fail-closed)", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: {} }),
      MalformedPayloadError,
    );
  });

  it("null byte in patch text is ParseUnsafeError", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Add File: a\0b" } }),
      ParseUnsafeError,
    );
  });
});

describe("parser — file tools", () => {
  it("resolves leading ./ against explicit cwd", () => {
    const parsed = parseEvent(load("read-env.json"));
    assert.equal(parsed.tool, "Read");
    if (parsed.tool !== "Read") throw new Error("unreachable");
    assert.equal(parsed.rawPath, "./.env");
    assert.equal(parsed.normalizedPath, "repo/.env");
  });

  it("expands leading ~ to the home directory", () => {
    const parsed = parseEvent({
      hook_event_name: "PreToolUse", cwd: "/repo", tool_name: "Read", tool_input: { file_path: "~/.ssh/id_rsa" },
    });
    if (parsed.tool !== "Read") throw new Error("unreachable");
    const expected = homedir().replace(/^\/+/, "") + "/.ssh/id_rsa";
    assert.equal(parsed.normalizedPath, expected);
  });

  it("resolves .. against the working directory", () => {
    const parsed = parseEvent({
      hook_event_name: "PreToolUse", cwd: "/repo/src", tool_name: "Edit", tool_input: { file_path: "../package.json" },
    });
    if (parsed.tool !== "Edit") throw new Error("unreachable");
    assert.equal(parsed.normalizedPath, "repo/package.json");
  });

  it("throws ParseUnsafeError on null byte in path", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", cwd: "/repo", tool_name: "Write", tool_input: { file_path: "a\0b" } }),
      ParseUnsafeError,
    );
  });

  it("throws MalformedPayloadError when file_path is missing", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }),
      MalformedPayloadError,
    );
  });
});

describe("parser — WebFetch", () => {
  it("parses external URL, strips query/fragment from host", () => {
    const parsed = parseEvent(load("webfetch-external.json"));
    if (parsed.tool !== "WebFetch") throw new Error("unreachable");
    assert.equal(parsed.host, "api.example.com");
    assert.equal(parsed.scope, "external");
  });
  it("parses internal URL", () => {
    const parsed = parseEvent(load("webfetch-internal.json"));
    if (parsed.tool !== "WebFetch") throw new Error("unreachable");
    assert.equal(parsed.host, "127.0.0.1");
    assert.equal(parsed.scope, "internal");
  });
  it("throws ParseUnsafeError on unparseable URL", () => {
    assert.throws(() => parseEvent(load("webfetch-bad-url.json")), ParseUnsafeError);
  });
  it("throws MalformedPayloadError when url is missing", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: {} }),
      MalformedPayloadError,
    );
  });
});

describe("parser — WebSearch", () => {
  it("parses a WebSearch event", () => {
    const parsed = parseEvent(load("websearch.json"));
    if (parsed.tool !== "WebSearch") throw new Error("unreachable");
    assert.equal(parsed.query, "vinctor runtime authorization");
  });
  it("throws MalformedPayloadError when query is missing", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "WebSearch", tool_input: {} }),
      MalformedPayloadError,
    );
  });
});

describe("parser — malformed events", () => {
  it("missing tool_name throws MalformedPayloadError", () => {
    assert.throws(() => parseEvent(load("malformed.json")), MalformedPayloadError);
  });

  it("unsupported tool_name (e.g. Glob) throws", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "Glob", tool_input: {} }),
      MalformedPayloadError,
    );
  });

  it("wrong hook_event_name throws MalformedPayloadError", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }),
      MalformedPayloadError,
    );
  });
});

describe("parser — MCP", () => {
  it("parses an MCP filesystem event", () => {
    const parsed = parseEvent(load("mcp-filesystem-read.json"));
    assert.equal(parsed.tool, "mcp__filesystem__read_file");
    if (!("toolInput" in parsed)) throw new Error("expected MCPParsed branch");
    assert.equal(parsed.toolName, "mcp__filesystem__read_file");
    assert.deepEqual(parsed.toolInput, { path: "/etc/passwd" });
  });

  it("rejects mcp__ prefix with empty server or tool segment", () => {
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "mcp____foo", tool_input: {} }),
      MalformedPayloadError,
    );
    assert.throws(
      () => parseEvent({ hook_event_name: "PreToolUse", tool_name: "mcp__server__", tool_input: {} }),
      MalformedPayloadError,
    );
  });

  it("accepts an MCP server name containing an underscore (regression)", () => {
    const parsed = parseEvent({
      hook_event_name: "PreToolUse",
      tool_name: "mcp__notion_internal__create_page",
      tool_input: { title: "x" },
    });
    assert.equal(parsed.tool, "mcp__notion_internal__create_page");
  });
});

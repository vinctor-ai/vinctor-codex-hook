import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isMcpToolName, splitMcpToolName } from "../src/mcp-name.js";

describe("splitMcpToolName", () => {
  it("splits a simple server/tool", () => {
    assert.deepEqual(splitMcpToolName("mcp__filesystem__read_file"), {
      server: "filesystem",
      tool: "read_file",
    });
  });

  it("allows an underscore in the server segment (regression: underscore hard-deny)", () => {
    assert.deepEqual(splitMcpToolName("mcp__notion_internal__create_page"), {
      server: "notion_internal",
      tool: "create_page",
    });
  });

  it("allows `__` inside the tool segment (splits on the FIRST separator)", () => {
    assert.deepEqual(splitMcpToolName("mcp__a__b__c"), { server: "a", tool: "b__c" });
  });

  it("rejects a missing mcp__ prefix", () => {
    assert.equal(splitMcpToolName("filesystem__read_file"), null);
    assert.equal(splitMcpToolName("Bash"), null);
  });

  it("rejects an empty server segment", () => {
    assert.equal(splitMcpToolName("mcp____foo"), null);
  });

  it("rejects an empty tool segment", () => {
    assert.equal(splitMcpToolName("mcp__server__"), null);
  });

  it("rejects a name with no separator after the prefix", () => {
    assert.equal(splitMcpToolName("mcp__server"), null);
  });
});

describe("isMcpToolName", () => {
  it("is true for valid names incl. underscore servers", () => {
    assert.equal(isMcpToolName("mcp__filesystem__read_file"), true);
    assert.equal(isMcpToolName("mcp__notion_internal__create_page"), true);
  });
  it("is false for invalid shapes", () => {
    assert.equal(isMcpToolName("mcp____foo"), false);
    assert.equal(isMcpToolName("mcp__server__"), false);
    assert.equal(isMcpToolName("Glob"), false);
  });
});

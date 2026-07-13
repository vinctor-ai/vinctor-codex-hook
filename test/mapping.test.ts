import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateRule, sortBySpecificity, getInputForRule, resolve } from "../src/mapping.js";
import { allDefaultsInOrder } from "../src/defaults/index.js";
import type { ParsedEvent, Rule } from "../src/types.js";

const rule = (over: Partial<Rule>): Rule => ({
  tool: "Bash", matchType: "exact", pattern: "x", action: "execute", resource: "x", ...over,
});

describe("mapping primitives", () => {
  describe("evaluateRule", () => {
    it("exact match for Bash", () => {
      assert.ok(evaluateRule(rule({ matchType: "exact", pattern: "npm test" }), "Bash", "npm test"));
      assert.ok(!evaluateRule(rule({ matchType: "exact", pattern: "npm test" }), "Bash", "npm test --silent"));
    });
    it("prefix match treats spaces as token boundaries", () => {
      assert.ok(evaluateRule(rule({ matchType: "prefix", pattern: "npm publish" }), "Bash", "npm publish --tag beta"));
      assert.ok(!evaluateRule(rule({ matchType: "prefix", pattern: "npm publish" }), "Bash", "npm publish-cli"));
    });
    it("glob match for a file path", () => {
      assert.ok(evaluateRule(rule({ tool: "Read", matchType: "glob", pattern: "**/.env*" }), "Read", "repo/.env.production"));
      assert.ok(!evaluateRule(rule({ tool: "Read", matchType: "glob", pattern: "**/.env" }), "Read", "repo/src/index.ts"));
    });
  });

  describe("sortBySpecificity", () => {
    it("exact > prefix > glob", () => {
      const sorted = sortBySpecificity([
        rule({ matchType: "glob", pattern: "**/*" }),
        rule({ matchType: "exact", pattern: "x" }),
        rule({ matchType: "prefix", pattern: "x" }),
      ]);
      assert.deepEqual(sorted.map((r) => r.matchType), ["exact", "prefix", "glob"]);
    });
    it("more literal tokens win within same matchType", () => {
      const sorted = sortBySpecificity([
        rule({ matchType: "prefix", pattern: "git push" }),
        rule({ matchType: "prefix", pattern: "git push --force" }),
      ]);
      assert.equal(sorted[0]!.pattern, "git push --force");
    });
    it("fewer wildcards win as tie-breaker", () => {
      const sorted = sortBySpecificity([
        rule({ matchType: "glob", pattern: "**/foo/**" }),
        rule({ matchType: "glob", pattern: "src/foo/bar" }),
      ]);
      assert.equal(sorted[0]!.pattern, "src/foo/bar");
    });
  });

  describe("glob `*` vs `**` semantics", () => {
    it("`*` matches a single segment, not across `/`", () => {
      assert.ok(evaluateRule(rule({ tool: "Read", matchType: "glob", pattern: "src/*" }), "Read", "src/foo"));
      assert.ok(!evaluateRule(rule({ tool: "Read", matchType: "glob", pattern: "src/*" }), "Read", "src/foo/bar"));
    });
    it("`**` matches across segments; leading `**/` at any depth", () => {
      assert.ok(evaluateRule(rule({ tool: "Read", matchType: "glob", pattern: "src/**" }), "Read", "src/a/b/c"));
      assert.ok(evaluateRule(rule({ tool: "Read", matchType: "glob", pattern: "**/.env" }), "Read", "deep/repo/.env"));
    });
  });
});

describe("defaults aggregator", () => {
  it("first rule is a secret/env read; includes Bash and file-tool rules", () => {
    const all = allDefaultsInOrder();
    assert.equal(all[0]!.resource, "secret/env");
    assert.ok(all.length > 10);
    assert.ok(all.some((r) => r.tool === "Bash"));
    assert.ok(all.some((r) => r.tool === "Write"));
  });
});

const bash = (cmd: string): ParsedEvent => ({
  tool: "Bash", rawCommand: cmd, normalizedCommand: cmd, firstToken: cmd.split(" ")[0] ?? "",
});
const file = (tool: "Read" | "Write" | "Edit" | "MultiEdit", p: string): ParsedEvent => ({
  tool, rawPath: p, normalizedPath: p,
});
const patch = (ops: Array<["write" | "delete", string]>): ParsedEvent => ({
  tool: "apply_patch",
  ops: ops.map(([action, normalizedPath]) => ({ action, rawPath: normalizedPath, normalizedPath })),
});
const mcp = (toolName: string, toolInput: Record<string, unknown>): ParsedEvent =>
  ({ tool: toolName as `mcp__${string}__${string}`, toolName, toolInput });
const empty = { version: 1 as const, rules: [] };

describe("resolve — Bash", () => {
  it("config rule wins over built-in default", () => {
    const r = resolve(bash("npm publish"), {
      version: 1,
      rules: [{ tool: "Bash", matchType: "exact", pattern: "npm publish", action: "execute", resource: "ci/release-custom" }],
    });
    assert.deepEqual(r, { kind: "Mapped", action: "execute", resource: "ci/release-custom", source: "config" });
  });
  it("classifier maps a known family (git force-push)", () => {
    const r = resolve(bash("git push --force origin main"), empty);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") assert.equal(r.resource, "git/push-force");
  });
  it("classifier NotApplicable falls through to a matching default (printenv)", () => {
    const r = resolve(bash("printenv"), empty);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "secret/env"); assert.equal(r.source, "defaults"); }
  });
  it("RecognizedButUnclassified (git push --weird) → Unmapped (no fallthrough)", () => {
    assert.deepEqual(resolve(bash("git push --weird-flag"), empty), { kind: "Unmapped" });
  });
  it("entirely unmapped Bash command → Unmapped", () => {
    assert.deepEqual(resolve(bash("ls -la"), empty), { kind: "Unmapped" });
  });
});

describe("resolve — file tools", () => {
  it("Read of a secret file → read:secret/env via defaults", () => {
    const r = resolve(file("Read", "home/u/.env"), empty);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "secret/env"); assert.equal(r.action, "read"); }
  });
  it("Write of a secret file → write:secret/env (write-side symmetry)", () => {
    const r = resolve(file("Write", "repo/.env"), empty);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "secret/env"); assert.equal(r.action, "write"); }
  });
  it("Edit of a CI workflow → write:ci/workflow", () => {
    const r = resolve(file("Edit", "repo/.github/workflows/ci.yml"), empty);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") assert.equal(r.resource, "ci/workflow");
  });
  it("ordinary source file → Unmapped", () => {
    assert.deepEqual(resolve(file("Read", "repo/src/index.ts"), empty), { kind: "Unmapped" });
  });
});

describe("resolve — WebFetch / WebSearch", () => {
  it("WebFetch external → send:net/external/<host> (universal default)", () => {
    const ev: ParsedEvent = { tool: "WebFetch", rawUrl: "https://api.example.com/x", host: "api.example.com", scope: "external" };
    assert.deepEqual(resolve(ev, empty), { kind: "Mapped", action: "send", resource: "net/external/api.example.com", source: "defaults" });
  });
  it("WebFetch internal → send:net/internal/<host>", () => {
    const ev: ParsedEvent = { tool: "WebFetch", rawUrl: "http://127.0.0.1/x", host: "127.0.0.1", scope: "internal" };
    assert.deepEqual(resolve(ev, empty), { kind: "Mapped", action: "send", resource: "net/internal/127.0.0.1", source: "defaults" });
  });
  it("WebFetch operator config overrides the universal default", () => {
    const ev: ParsedEvent = { tool: "WebFetch", rawUrl: "https://docs.x.internal.com/x", host: "docs.x.internal.com", scope: "external" };
    const r = resolve(ev, { version: 1, rules: [{ tool: "WebFetch", matchType: "glob", pattern: "docs.*.internal.com", action: "read", resource: "docs/internal" }] });
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "docs/internal", source: "config" });
  });
  it("WebSearch no rule → Unmapped", () => {
    assert.deepEqual(resolve({ tool: "WebSearch", query: "vinctor" }, empty), { kind: "Unmapped" });
  });
  it("WebSearch matching operator rule → Mapped from config", () => {
    const r = resolve({ tool: "WebSearch", query: "salary bands" }, {
      version: 1, rules: [{ tool: "WebSearch", matchType: "prefix", pattern: "salary", action: "send", resource: "web/search/sensitive" }],
    });
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "web/search/sensitive"); assert.equal(r.source, "config"); }
  });
});

describe("resolve — apply_patch", () => {
  it("editing a secret file → write:secret/env from defaults", () => {
    assert.deepEqual(resolve(patch([["write", "config/.env"]]), empty), { kind: "Mapped", action: "write", resource: "secret/env", source: "defaults" });
  });
  it("deleting a protected CI workflow → delete:ci/workflow", () => {
    assert.deepEqual(resolve(patch([["delete", ".github/workflows/ci.yml"]]), empty), { kind: "Mapped", action: "delete", resource: "ci/workflow", source: "defaults" });
  });
  it("ordinary source file edit → Unmapped (abstain)", () => {
    assert.deepEqual(resolve(patch([["write", "src/index.ts"]]), empty), { kind: "Unmapped" });
  });
  it("multi-op patch: most destructive in-boundary op wins (delete > write)", () => {
    const r = resolve(patch([["write", "package.json"], ["delete", ".github/workflows/ci.yml"]]), empty);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.action, "delete"); assert.equal(r.resource, "ci/workflow"); }
  });
  it("operator config rule (matched against an op path) wins over defaults", () => {
    const r = resolve(patch([["write", "db/migrations/001.sql"]]), {
      version: 1, rules: [{ tool: "apply_patch", matchType: "glob", pattern: "**/migrations/**", action: "deploy", resource: "db/migration" }],
    });
    assert.deepEqual(r, { kind: "Mapped", action: "deploy", resource: "db/migration", source: "config" });
  });
  it("zero ops → Unmapped", () => {
    assert.deepEqual(resolve(patch([]), empty), { kind: "Unmapped" });
  });
});

describe("resolve — MCP", () => {
  it("classifier maps mcp__filesystem__read_file", () => {
    assert.deepEqual(resolve(mcp("mcp__filesystem__read_file", { path: "/etc/passwd" }), empty),
      { kind: "Mapped", action: "read", resource: "fs/etc/passwd", source: "classifier" });
  });
  it("operator config overrides the classifier", () => {
    const r = resolve(mcp("mcp__filesystem__read_file", { path: "/etc/passwd" }), {
      version: 1, rules: [{ tool: "mcp__filesystem__read_file", matchType: "glob", pattern: "**/etc/**", inputField: "path", action: "read", resource: "secret/etc" }],
    });
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "secret/etc"); assert.equal(r.source, "config"); }
  });
  it("unknown server → Unmapped (abstain)", () => {
    assert.deepEqual(resolve(mcp("mcp__postgres__query", { sql: "SELECT 1" }), empty), { kind: "Unmapped" });
  });
});

describe("getInputForRule", () => {
  const dummy = (over: Partial<Rule>): Rule => rule(over);
  it("Bash → normalizedCommand", () => {
    assert.equal(getInputForRule(dummy({ tool: "Bash" }), bash("npm publish")), "npm publish");
  });
  it("file tool → normalizedPath", () => {
    assert.equal(getInputForRule(dummy({ tool: "Read" }), file("Read", "repo/.env")), "repo/.env");
  });
  it("WebFetch → host", () => {
    const ev: ParsedEvent = { tool: "WebFetch", rawUrl: "https://api.example.com/x", host: "api.example.com", scope: "external" };
    assert.equal(getInputForRule(dummy({ tool: "WebFetch" }), ev), "api.example.com");
  });
  it("WebSearch → query", () => {
    assert.equal(getInputForRule(dummy({ tool: "WebSearch" }), { tool: "WebSearch", query: "company secret" }), "company secret");
  });
  it("apply_patch → op summary for display", () => {
    assert.equal(getInputForRule(dummy({ tool: "apply_patch" }), patch([["write", "a.ts"], ["delete", "b.ts"]])), "write a.ts, delete b.ts");
  });
  it("MCP with inputField → field value", () => {
    const ev: ParsedEvent = { tool: "mcp__filesystem__read_file", toolName: "mcp__filesystem__read_file", toolInput: { path: "/etc/passwd" } };
    assert.equal(getInputForRule(dummy({ tool: "mcp__filesystem__read_file", inputField: "path" }), ev), "/etc/passwd");
  });
  it("MCP with inputField missing → null", () => {
    const ev: ParsedEvent = { tool: "mcp__filesystem__read_file", toolName: "mcp__filesystem__read_file", toolInput: {} };
    assert.equal(getInputForRule(dummy({ tool: "mcp__filesystem__read_file", inputField: "path" }), ev), null);
  });
  it("MCP with inputField non-string → null", () => {
    const ev: ParsedEvent = { tool: "mcp__filesystem__read_file", toolName: "mcp__filesystem__read_file", toolInput: { path: 123 } };
    assert.equal(getInputForRule(dummy({ tool: "mcp__filesystem__read_file", inputField: "path" }), ev), null);
  });
});

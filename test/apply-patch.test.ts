import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseApplyPatchOps, patchTextFromInput } from "../src/apply-patch.js";

describe("parseApplyPatchOps", () => {
  it("maps Add File and Update File to write, Delete File to delete", () => {
    const ops = parseApplyPatchOps(
      [
        "*** Begin Patch",
        "*** Add File: a.txt",
        "+hello",
        "*** Update File: b/c.ts",
        "@@",
        "-x",
        "+y",
        "*** Delete File: old.txt",
        "*** End Patch",
      ].join("\n"),
    );
    assert.deepEqual(ops.map((o) => [o.action, o.normalizedPath]), [
      ["write", "a.txt"],
      ["write", "b/c.ts"],
      ["delete", "old.txt"],
    ]);
  });

  it("Move to retargets the preceding write op's path", () => {
    const ops = parseApplyPatchOps(
      ["*** Update File: old/name.ts", "*** Move to: new/name.ts", "@@", "+x"].join("\n"),
    );
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.action, "write");
    assert.equal(ops[0]!.normalizedPath, "new/name.ts");
  });

  it("normalizes leading ./ and / in paths", () => {
    const ops = parseApplyPatchOps("*** Update File: ./src/x.ts\n*** Delete File: /etc/hosts");
    assert.equal(ops[0]!.normalizedPath, "src/x.ts");
    assert.equal(ops[1]!.normalizedPath, "etc/hosts");
  });

  it("ignores hunk body lines that look like nothing and returns [] with no headers", () => {
    assert.deepEqual(parseApplyPatchOps("just some text\n+not a header"), []);
  });

  it("ignores an empty path after the marker", () => {
    assert.deepEqual(parseApplyPatchOps("*** Add File: "), []);
  });
});

describe("parseApplyPatchOps — realistic / robustness", () => {
  it("parses a realistic multi-file, multi-hunk patch (only headers, not hunk bodies)", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/auth.ts",
      "@@ class Auth",
      " context line",
      "-  const x = 1",
      "+  const x = 2",
      "@@ another hunk",
      "+  added",
      "*** Add File: docs/new.md",
      "+# New",
      "+body",
      "*** Delete File: legacy/old.ts",
      "*** End Patch",
    ].join("\n");
    const ops = parseApplyPatchOps(patch);
    assert.deepEqual(ops.map((o) => [o.action, o.normalizedPath]), [
      ["write", "src/auth.ts"],
      ["write", "docs/new.md"],
      ["delete", "legacy/old.ts"],
    ]);
  });

  it("does not mistake a hunk body line that resembles a header for a real op", () => {
    // A removed/added line whose text starts with "*** Update File:" is prefixed
    // by -/+, so it never matches the `^\*\*\* ` header anchor.
    const patch = [
      "*** Begin Patch",
      "*** Update File: real.ts",
      "@@",
      "-*** Update File: fake-removed.ts",
      "+*** Add File: fake-added.ts",
      "*** End Patch",
    ].join("\n");
    const ops = parseApplyPatchOps(patch);
    assert.deepEqual(ops.map((o) => o.normalizedPath), ["real.ts"]);
  });

  it("handles CRLF line endings", () => {
    const ops = parseApplyPatchOps("*** Begin Patch\r\n*** Update File: a/b.ts\r\n+x\r\n*** End Patch\r\n");
    assert.deepEqual(ops, [{ action: "write", rawPath: "a/b.ts", normalizedPath: "a/b.ts" }]);
  });

  it("preserves a path containing spaces", () => {
    const ops = parseApplyPatchOps("*** Add File: my docs/notes file.md\n+x");
    assert.equal(ops[0]!.normalizedPath, "my docs/notes file.md");
  });
});

describe("patchTextFromInput", () => {
  it("reads the current Codex tool_input.command wire field", () => {
    assert.equal(patchTextFromInput({ command: "CURRENT" }), "CURRENT");
  });
  it("prefers command over legacy-compatible fields", () => {
    assert.equal(patchTextFromInput({ command: "CURRENT", input: "A", patch: "B" }), "CURRENT");
  });
  it("prefers input over patch", () => {
    assert.equal(patchTextFromInput({ input: "A", patch: "B" }), "A");
  });
  it("falls back to patch", () => {
    assert.equal(patchTextFromInput({ patch: "B" }), "B");
  });
  it("returns null when neither is a non-empty string", () => {
    assert.equal(patchTextFromInput({ input: "" }), null);
    assert.equal(patchTextFromInput({ other: "x" }), null);
    assert.equal(patchTextFromInput({ input: 5 }), null);
  });
});

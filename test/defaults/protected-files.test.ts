import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { protectedFilesRules } from "../../src/defaults/protected-files.js";
import { evaluateRule } from "../../src/mapping.js";
import type { FileTool } from "../../src/types.js";

const matches = (tool: FileTool, input: string) =>
  protectedFilesRules.some((r) => r.tool === tool && evaluateRule(r, tool, input));

describe("defaults: protected-files", () => {
  it("matches .github/workflows/*.yml for Write/Edit/MultiEdit", () => {
    for (const t of ["Write", "Edit", "MultiEdit"] as const) {
      assert.ok(matches(t, "repo/.github/workflows/ci.yml"), `should match for ${t}`);
    }
  });
  it("matches root package.json for Write/Edit/MultiEdit", () => {
    assert.ok(matches("Write", "repo/package.json"));
  });
  it("matches Dockerfile / terraform / k8s manifests", () => {
    assert.ok(matches("Edit", "repo/Dockerfile"));
    assert.ok(matches("Edit", "repo/infra/main.tf"));
    assert.ok(matches("Edit", "repo/k8s/deployment.yaml"));
  });
  it("does not match arbitrary source files", () => {
    assert.ok(!matches("Edit", "repo/src/foo.ts"));
  });
});

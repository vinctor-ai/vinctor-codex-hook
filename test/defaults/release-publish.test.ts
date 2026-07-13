import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { releasePublishRules } from "../../src/defaults/release-publish.js";
import { evaluateRule } from "../../src/mapping.js";

const bashMatches = (input: string) =>
  releasePublishRules.some((r) => r.tool === "Bash" && evaluateRule(r, "Bash", input));

describe("defaults: release-publish", () => {
  it("matches npm publish + variants", () => {
    assert.ok(bashMatches("npm publish"));
    assert.ok(bashMatches("npm publish --tag beta"));
  });
  it("matches pnpm publish", () => {
    assert.ok(bashMatches("pnpm publish"));
  });
  it("matches yarn publish", () => {
    assert.ok(bashMatches("yarn publish"));
  });
  it("matches docker push", () => {
    assert.ok(bashMatches("docker push myimage:latest"));
  });
  it("matches gh release create", () => {
    assert.ok(bashMatches("gh release create v1.0.0"));
  });
  it("matches cargo publish", () => {
    assert.ok(bashMatches("cargo publish"));
  });
  it("does not match generic commands", () => {
    assert.ok(!bashMatches("npm install"));
    assert.ok(!bashMatches("git status"));
  });
});

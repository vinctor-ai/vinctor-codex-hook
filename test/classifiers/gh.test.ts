import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ghClassifier } from "../../src/classifiers/gh.js";
import { dispatchClassifier } from "../../src/classifiers/index.js";

describe("classifier: gh", () => {
  it("gh release create -> deploy:gh/release", () => {
    assert.deepEqual(ghClassifier("gh release create v1"), { kind: "Mapped", action: "deploy", resource: "gh/release" });
  });
  it("gh secret set -> write:secret/gh", () => {
    assert.deepEqual(ghClassifier("gh secret set TOKEN"), { kind: "Mapped", action: "write", resource: "secret/gh" });
  });
  it("gh api -> NotApplicable (too generic)", () => {
    assert.equal(ghClassifier("gh api /user").kind, "NotApplicable");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(ghClassifier("git push").kind, "NotApplicable");
    assert.equal(ghClassifier("ls -la").kind, "NotApplicable");
  });
});

describe("classifier registry", () => {
  it("dispatches by first token", () => {
    assert.equal(dispatchClassifier("git", "git push --force origin main").kind, "Mapped");
    assert.equal(dispatchClassifier("npm", "npm publish").kind, "Mapped");
    assert.equal(dispatchClassifier("docker", "docker push img").kind, "Mapped");
    assert.equal(dispatchClassifier("gh", "gh release create v1").kind, "Mapped");
  });
  it("unknown family returns NotApplicable", () => {
    assert.equal(dispatchClassifier("foo", "foo bar").kind, "NotApplicable");
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ghClassifier } from "../../src/classifiers/gh.js";
import { dispatchClassifier } from "../../src/classifiers/index.js";

describe("classifier: gh — canon github/<owner>/<repo>/<kind>", () => {
  it("gh pr merge --repo <o>/<r> -> deploy:github/<o>/<r>/pr (CLI analog of merge_pull_request)", () => {
    assert.deepEqual(ghClassifier("gh pr merge 42 --repo acme/api"),
      { kind: "Mapped", action: "deploy", resource: "github/acme/api/pr" });
    assert.deepEqual(ghClassifier("gh pr merge 42 -R acme/api --squash"),
      { kind: "Mapped", action: "deploy", resource: "github/acme/api/pr" });
  });
  it("gh release create --repo <o>/<r> -> deploy:github/<o>/<r>/release", () => {
    assert.deepEqual(ghClassifier("gh release create v1.2.0 --repo acme/api"),
      { kind: "Mapped", action: "deploy", resource: "github/acme/api/release" });
    assert.deepEqual(ghClassifier("gh release create v1 --repo=github.com/acme/api"),
      { kind: "Mapped", action: "deploy", resource: "github/acme/api/release" });
  });
  it("gh secret set --repo <o>/<r> -> write:github/<o>/<r>/secret", () => {
    assert.deepEqual(ghClassifier("gh secret set DEPLOY_TOKEN --repo acme/api"),
      { kind: "Mapped", action: "write", resource: "github/acme/api/secret" });
  });
  it("without --repo the target repo is unresolvable: legacy coarse resources are preserved", () => {
    assert.deepEqual(ghClassifier("gh release create v1"), { kind: "Mapped", action: "deploy", resource: "gh/release" });
    assert.deepEqual(ghClassifier("gh secret set TOKEN"), { kind: "Mapped", action: "write", resource: "secret/gh" });
    assert.equal(ghClassifier("gh pr merge 42").kind, "NotApplicable");
  });
  it("malformed or traversal-shaped --repo values fall back to the unresolved path", () => {
    assert.deepEqual(ghClassifier("gh release create v1 --repo not-a-spec"),
      { kind: "Mapped", action: "deploy", resource: "gh/release" });
    assert.deepEqual(ghClassifier("gh secret set T --repo ../.."),
      { kind: "Mapped", action: "write", resource: "secret/gh" });
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

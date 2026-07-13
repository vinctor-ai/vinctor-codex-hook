import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyProtectedPath } from "../../src/defaults/protected-paths.js";

describe("defaults: protected-paths (apply_patch targets)", () => {
  it("classifies CI workflow files → ci/workflow", () => {
    assert.equal(classifyProtectedPath("repo/.github/workflows/ci.yml"), "ci/workflow");
    assert.equal(classifyProtectedPath("repo/.github/workflows/release.yaml"), "ci/workflow");
  });
  it("classifies package.json → repo/manifest/npm", () => {
    assert.equal(classifyProtectedPath("repo/package.json"), "repo/manifest/npm");
  });
  it("classifies Dockerfile variants → infra/dockerfile", () => {
    assert.equal(classifyProtectedPath("repo/Dockerfile"), "infra/dockerfile");
    assert.equal(classifyProtectedPath("repo/Dockerfile.prod"), "infra/dockerfile");
  });
  it("classifies terraform and k8s manifests", () => {
    assert.equal(classifyProtectedPath("repo/infra/main.tf"), "infra/terraform");
    assert.equal(classifyProtectedPath("repo/k8s/deployment.yaml"), "infra/k8s");
  });
  it("returns null for ordinary source files", () => {
    assert.equal(classifyProtectedPath("repo/src/index.ts"), null);
  });
});

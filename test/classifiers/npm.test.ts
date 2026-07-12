import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { npmClassifier } from "../../src/classifiers/npm.js";

describe("classifier: npm/pnpm/yarn", () => {
  it("npm publish classifies as deploy / npm/package", () => {
    assert.deepEqual(npmClassifier("npm publish --tag beta"), { kind: "Mapped", action: "deploy", resource: "npm/package" });
  });
  it("pnpm publish classifies as deploy / npm/package", () => {
    assert.deepEqual(npmClassifier("pnpm publish"), { kind: "Mapped", action: "deploy", resource: "npm/package" });
  });
  it("yarn publish classifies as deploy / npm/package", () => {
    assert.deepEqual(npmClassifier("yarn publish"), { kind: "Mapped", action: "deploy", resource: "npm/package" });
  });
  it("install/run NotApplicable", () => {
    assert.equal(npmClassifier("npm install").kind, "NotApplicable");
    assert.equal(npmClassifier("npm run build").kind, "NotApplicable");
    assert.equal(npmClassifier("pnpm install").kind, "NotApplicable");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(npmClassifier("git push").kind, "NotApplicable");
    assert.equal(npmClassifier("ls -la").kind, "NotApplicable");
  });
});

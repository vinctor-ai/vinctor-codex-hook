import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { npmClassifier } from "../../src/classifiers/npm.js";

describe("classifier: npm/pnpm/yarn/npx", () => {
  it("npm publish classifies as deploy / pkg/npm/_ (package name not in command text)", () => {
    assert.deepEqual(npmClassifier("npm publish --tag beta"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/_" });
  });
  it("npm publish --workspace <name> carries the package name → pkg/npm/<name>", () => {
    assert.deepEqual(npmClassifier("npm publish --workspace left-pad"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/left-pad" });
    assert.deepEqual(npmClassifier("npm publish -w left-pad"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/left-pad" });
    assert.deepEqual(npmClassifier("npm publish --workspace=@acme/api-client"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/@acme/api-client" });
    assert.deepEqual(npmClassifier("npm publish -w @acme/api-client --tag beta"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/@acme/api-client" });
  });
  it("path-shaped or multiple workspace values fall back to pkg/npm/_ (one resource per call)", () => {
    assert.deepEqual(npmClassifier("npm publish -w packages/left-pad"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/_" });
    assert.deepEqual(npmClassifier("npm publish -w ./left-pad"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/_" });
    assert.deepEqual(npmClassifier("npm publish -w a -w b"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/_" });
  });
  it("pnpm publish classifies as deploy / pkg/npm/_", () => {
    assert.deepEqual(npmClassifier("pnpm publish"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/_" });
  });
  it("yarn publish classifies as deploy / pkg/npm/_", () => {
    assert.deepEqual(npmClassifier("yarn publish"), { kind: "Mapped", action: "deploy", resource: "pkg/npm/_" });
  });
  it("script/install subcommands → execute:shell/<first-token> (canon shell family)", () => {
    assert.deepEqual(npmClassifier("npm test"), { kind: "Mapped", action: "execute", resource: "shell/npm" });
    assert.deepEqual(npmClassifier("npm run build"), { kind: "Mapped", action: "execute", resource: "shell/npm" });
    assert.deepEqual(npmClassifier("npm install"), { kind: "Mapped", action: "execute", resource: "shell/npm" });
    assert.deepEqual(npmClassifier("npm ci"), { kind: "Mapped", action: "execute", resource: "shell/npm" });
    assert.deepEqual(npmClassifier("pnpm install"), { kind: "Mapped", action: "execute", resource: "shell/pnpm" });
    assert.deepEqual(npmClassifier("yarn test"), { kind: "Mapped", action: "execute", resource: "shell/yarn" });
  });
  it("npx runs an arbitrary fetched binary → execute:shell/npx", () => {
    assert.deepEqual(npmClassifier("npx cowsay"), { kind: "Mapped", action: "execute", resource: "shell/npx" });
    assert.deepEqual(npmClassifier("npx --yes create-vite my-app"), { kind: "Mapped", action: "execute", resource: "shell/npx" });
  });
  it("unlisted subcommands stay NotApplicable (defaults get a shot)", () => {
    assert.equal(npmClassifier("npm view left-pad").kind, "NotApplicable");
    assert.equal(npmClassifier("npm ls").kind, "NotApplicable");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(npmClassifier("git push").kind, "NotApplicable");
    assert.equal(npmClassifier("ls -la").kind, "NotApplicable");
  });
});

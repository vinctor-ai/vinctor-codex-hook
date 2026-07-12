import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { gitClassifier } from "../../src/classifiers/git.js";

describe("classifier: git", () => {
  it("classifies git push --force as execute / git/push-force", () => {
    const r = gitClassifier("git push --force origin main");
    assert.deepEqual(r, { kind: "Mapped", action: "execute", resource: "git/push-force" });
  });
  it("classifies git push --force-with-lease as execute / git/push-force", () => {
    const r = gitClassifier("git push --force-with-lease origin main");
    assert.deepEqual(r, { kind: "Mapped", action: "execute", resource: "git/push-force" });
  });
  it("classifies git reset --hard as delete / git/reset-hard", () => {
    const r = gitClassifier("git reset --hard HEAD~3");
    assert.deepEqual(r, { kind: "Mapped", action: "delete", resource: "git/reset-hard" });
  });
  it("classifies git branch -D as delete / git/branch-delete-force", () => {
    const r = gitClassifier("git branch -D feature/old");
    assert.deepEqual(r, { kind: "Mapped", action: "delete", resource: "git/branch-delete-force" });
  });
  it("read-only commands are NotApplicable (defaults gets a shot)", () => {
    assert.equal(gitClassifier("git status").kind, "NotApplicable");
    assert.equal(gitClassifier("git log --oneline").kind, "NotApplicable");
  });
  it("recognized-but-unclassified for unfamiliar `git push` flags", () => {
    const r = gitClassifier("git push --unknown-flag");
    assert.equal(r.kind, "RecognizedButUnclassified");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(gitClassifier("npm publish").kind, "NotApplicable");
    assert.equal(gitClassifier("ls -la").kind, "NotApplicable");
  });
});

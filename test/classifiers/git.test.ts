import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { gitClassifier } from "../../src/classifiers/git.js";

describe("classifier: git — canon shell family", () => {
  it("read-only subcommands → read:shell/git", () => {
    for (const cmd of ["git status", "git log --oneline", "git diff HEAD~1", "git show", "git fetch origin"]) {
      assert.deepEqual(gitClassifier(cmd), { kind: "Mapped", action: "read", resource: "shell/git" }, cmd);
    }
  });
  it("read-only alias bindings (blame/describe/rev-parse) → read:shell/git", () => {
    for (const cmd of ["git blame src/a.ts", "git describe --tags", "git rev-parse HEAD"]) {
      assert.deepEqual(gitClassifier(cmd), { kind: "Mapped", action: "read", resource: "shell/git" }, cmd);
    }
  });
  it("local mutations → write:shell/git", () => {
    for (const cmd of ["git add .", "git commit -m x", "git stash", "git pull", "git clone https://github.com/acme/api.git"]) {
      assert.deepEqual(gitClassifier(cmd), { kind: "Mapped", action: "write", resource: "shell/git" }, cmd);
    }
  });
  it("destructive local operations → delete:shell/git", () => {
    assert.deepEqual(gitClassifier("git reset --hard HEAD~3"), { kind: "Mapped", action: "delete", resource: "shell/git" });
    assert.deepEqual(gitClassifier("git branch -D feature/old"), { kind: "Mapped", action: "delete", resource: "shell/git" });
    assert.deepEqual(gitClassifier("git clean -f"), { kind: "Mapped", action: "delete", resource: "shell/git" });
    assert.deepEqual(gitClassifier("git clean -fd"), { kind: "Mapped", action: "delete", resource: "shell/git" });
  });
  it("unlisted subcommands stay NotApplicable (defaults get a shot)", () => {
    assert.equal(gitClassifier("git rebase main").kind, "NotApplicable");
    assert.equal(gitClassifier("git checkout -b x").kind, "NotApplicable");
    assert.equal(gitClassifier("git reset --soft HEAD~1").kind, "NotApplicable");
    assert.equal(gitClassifier("git branch -d merged").kind, "NotApplicable");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(gitClassifier("npm publish").kind, "NotApplicable");
    assert.equal(gitClassifier("ls -la").kind, "NotApplicable");
  });
});

describe("classifier: git push — canon github/<owner>/<repo>/contents", () => {
  it("push to an https github remote → write:github/<o>/<r>/contents", () => {
    assert.deepEqual(gitClassifier("git push https://github.com/acme/api.git main"),
      { kind: "Mapped", action: "write", resource: "github/acme/api/contents" });
    assert.deepEqual(gitClassifier("git push https://github.com/widgets-inc/web-app main"),
      { kind: "Mapped", action: "write", resource: "github/widgets-inc/web-app/contents" });
  });
  it("push to an ssh github remote → write:github/<o>/<r>/contents", () => {
    assert.deepEqual(gitClassifier("git push git@github.com:acme/api.git main"),
      { kind: "Mapped", action: "write", resource: "github/acme/api/contents" });
    assert.deepEqual(gitClassifier("git push ssh://git@github.com/acme/api.git main"),
      { kind: "Mapped", action: "write", resource: "github/acme/api/contents" });
  });
  it("force push to a github remote → delete:github/<o>/<r>/contents (history destruction)", () => {
    assert.deepEqual(gitClassifier("git push --force https://github.com/acme/api.git feat/taxonomy"),
      { kind: "Mapped", action: "delete", resource: "github/acme/api/contents" });
    assert.deepEqual(gitClassifier("git push --force-with-lease git@github.com:acme/api.git main"),
      { kind: "Mapped", action: "delete", resource: "github/acme/api/contents" });
  });
  it("named remote (unresolvable owner/repo) keeps the legacy resource with canon action", () => {
    assert.deepEqual(gitClassifier("git push origin main"),
      { kind: "Mapped", action: "write", resource: "git/push" });
    assert.deepEqual(gitClassifier("git push -u origin HEAD"),
      { kind: "Mapped", action: "write", resource: "git/push" });
    assert.deepEqual(gitClassifier("git push --force origin main"),
      { kind: "Mapped", action: "delete", resource: "git/push-force" });
    assert.deepEqual(gitClassifier("git push -f"),
      { kind: "Mapped", action: "delete", resource: "git/push-force" });
  });
  it("traversal-shaped owner/repo segments are not interpolated into the resource", () => {
    const r = gitClassifier("git push https://github.com/../.. main");
    assert.notEqual(r.kind, "Mapped", "must not map a traversal segment");
  });
  it("recognized-but-unclassified for unfamiliar `git push` flags", () => {
    assert.equal(gitClassifier("git push --unknown-flag").kind, "RecognizedButUnclassified");
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rmClassifier } from "../../src/classifiers/rm.js";
import { dispatchClassifier } from "../../src/classifiers/index.js";

describe("classifier: rm/rmdir — canon delete:fs/<path>", () => {
  it("rm <path> → delete:fs/<normalized path>", () => {
    assert.deepEqual(rmClassifier("rm /home/dev/project/notes.txt"),
      { kind: "Mapped", action: "delete", resource: "fs/home/dev/project/notes.txt" });
    assert.deepEqual(rmClassifier("rm -rf build"),
      { kind: "Mapped", action: "delete", resource: "fs/build" });
    assert.deepEqual(rmClassifier("rm ./tmp/scratch.log"),
      { kind: "Mapped", action: "delete", resource: "fs/tmp/scratch.log" });
  });
  it("rmdir <path> → delete:fs/<normalized path>", () => {
    assert.deepEqual(rmClassifier("rmdir /home/dev/project/old"),
      { kind: "Mapped", action: "delete", resource: "fs/home/dev/project/old" });
  });
  it("deleting a sensitive file classifies over secret/<kind> (shared overlay)", () => {
    assert.deepEqual(rmClassifier("rm .env"),
      { kind: "Mapped", action: "delete", resource: "secret/env" });
    assert.deepEqual(rmClassifier("rm -f /home/u/.ssh/id_rsa"),
      { kind: "Mapped", action: "delete", resource: "secret/ssh" });
  });
  it("multi-target, glob, or pathless invocations → RBU (no single resource; abstain)", () => {
    assert.equal(rmClassifier("rm a.txt b.txt").kind, "RecognizedButUnclassified");
    assert.equal(rmClassifier("rm *.log").kind, "RecognizedButUnclassified");
    assert.equal(rmClassifier("rm -rf").kind, "RecognizedButUnclassified");
    assert.equal(rmClassifier("rm -rf /").kind, "RecognizedButUnclassified");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(rmClassifier("git push").kind, "NotApplicable");
  });
  it("is wired into the registry", () => {
    assert.deepEqual(dispatchClassifier("rm", "rm /tmp/x.txt"),
      { kind: "Mapped", action: "delete", resource: "fs/tmp/x.txt" });
    assert.deepEqual(dispatchClassifier("rmdir", "rmdir /tmp/dir"),
      { kind: "Mapped", action: "delete", resource: "fs/tmp/dir" });
  });
});

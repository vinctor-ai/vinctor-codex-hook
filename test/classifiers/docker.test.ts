import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { dockerClassifier } from "../../src/classifiers/docker.js";

describe("classifier: docker", () => {
  it("push classifies as deploy / docker/image", () => {
    assert.deepEqual(dockerClassifier("docker push myimg:latest"), { kind: "Mapped", action: "deploy", resource: "docker/image" });
  });
  it("rmi -f classifies as delete / docker/image-force", () => {
    assert.deepEqual(dockerClassifier("docker rmi -f abc123"), { kind: "Mapped", action: "delete", resource: "docker/image-force" });
  });
  it("build NotApplicable", () => {
    assert.equal(dockerClassifier("docker build -t myimg .").kind, "NotApplicable");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(dockerClassifier("git push").kind, "NotApplicable");
    assert.equal(dockerClassifier("kubectl apply -f x").kind, "NotApplicable");
  });
});

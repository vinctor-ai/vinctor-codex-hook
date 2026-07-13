import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { dockerClassifier } from "../../src/classifiers/docker.js";

describe("classifier: docker — canon container/<registry>/<image>", () => {
  it("push → deploy:container/<registry>/<image> (docker.io implicit)", () => {
    assert.deepEqual(dockerClassifier("docker push acme/api:1.4.2"),
      { kind: "Mapped", action: "deploy", resource: "container/docker.io/acme/api" });
    assert.deepEqual(dockerClassifier("docker push ghcr.io/vinctor-ai/vinctor:1.4.2"),
      { kind: "Mapped", action: "deploy", resource: "container/ghcr.io/vinctor-ai/vinctor" });
    assert.deepEqual(dockerClassifier("docker push myimg:latest"),
      { kind: "Mapped", action: "deploy", resource: "container/docker.io/myimg" });
  });
  it("push strips digests and handles registries with ports", () => {
    assert.deepEqual(dockerClassifier("docker push acme/api@sha256:deadbeef"),
      { kind: "Mapped", action: "deploy", resource: "container/docker.io/acme/api" });
    assert.deepEqual(dockerClassifier("docker push localhost:5000/acme/api:dev"),
      { kind: "Mapped", action: "deploy", resource: "container/localhost:5000/acme/api" });
  });
  it("rmi → delete:container/<registry>/<image> (force flag irrelevant to the verb)", () => {
    assert.deepEqual(dockerClassifier("docker rmi acme/api:1.4.2"),
      { kind: "Mapped", action: "delete", resource: "container/docker.io/acme/api" });
    assert.deepEqual(dockerClassifier("docker rmi -f abc123"),
      { kind: "Mapped", action: "delete", resource: "container/docker.io/abc123" });
  });
  it("build -t <ref> → execute:container/<registry>/<image> (RUN steps are arbitrary)", () => {
    assert.deepEqual(dockerClassifier("docker build -t acme/api:1.4.2 ."),
      { kind: "Mapped", action: "execute", resource: "container/docker.io/acme/api" });
    assert.deepEqual(dockerClassifier("docker build --tag=ghcr.io/acme/api:dev ."),
      { kind: "Mapped", action: "execute", resource: "container/ghcr.io/acme/api" });
  });
  it("build without a tag → RecognizedButUnclassified (image unidentifiable)", () => {
    assert.equal(dockerClassifier("docker build .").kind, "RecognizedButUnclassified");
  });
  it("run <ref> → execute:container/<registry>/<image>, skipping known no-value flags", () => {
    assert.deepEqual(dockerClassifier("docker run --rm acme/api:1.4.2"),
      { kind: "Mapped", action: "execute", resource: "container/docker.io/acme/api" });
    assert.deepEqual(dockerClassifier("docker run -d -it nginx"),
      { kind: "Mapped", action: "execute", resource: "container/docker.io/nginx" });
  });
  it("run with an unknown flag before the image → RBU (never guess a flag value as the image)", () => {
    assert.equal(dockerClassifier("docker run -e SECRET=x acme/api").kind, "RecognizedButUnclassified");
    assert.equal(dockerClassifier("docker run -p 80:80 nginx").kind, "RecognizedButUnclassified");
  });
  it("push/rmi with no parseable ref → RBU", () => {
    assert.equal(dockerClassifier("docker push").kind, "RecognizedButUnclassified");
    assert.equal(dockerClassifier("docker rmi -f").kind, "RecognizedButUnclassified");
  });
  it("unlisted subcommands stay NotApplicable (defaults get a shot)", () => {
    assert.equal(dockerClassifier("docker ps").kind, "NotApplicable");
    assert.equal(dockerClassifier("docker images").kind, "NotApplicable");
  });
  it("out-of-family input returns NotApplicable (defensive)", () => {
    assert.equal(dockerClassifier("git push").kind, "NotApplicable");
    assert.equal(dockerClassifier("kubectl apply -f x").kind, "NotApplicable");
  });
});

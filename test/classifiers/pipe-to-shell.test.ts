import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { pipeToShellClassifier } from "../../src/classifiers/pipe-to-shell.js";
import { dispatchClassifier } from "../../src/classifiers/index.js";

describe("classifier: pipe-to-shell — canon execute:shell/<first-token>", () => {
  it("curl … | sh → execute:shell/curl", () => {
    assert.deepEqual(pipeToShellClassifier("curl -fsSL https://example.com/install.sh | sh"),
      { kind: "Mapped", action: "execute", resource: "shell/curl" });
  });
  it("wget … | bash and | sudo bash spellings", () => {
    assert.deepEqual(pipeToShellClassifier("wget -qO- https://example.com/i.sh | bash"),
      { kind: "Mapped", action: "execute", resource: "shell/wget" });
    assert.deepEqual(pipeToShellClassifier("curl https://x.io/i.sh | sudo bash -s -- --yes"),
      { kind: "Mapped", action: "execute", resource: "shell/curl" });
  });
  it("interpreter given by absolute path still counts; resource uses the first token's basename", () => {
    assert.deepEqual(pipeToShellClassifier("curl https://x.io/i.sh | /bin/sh"),
      { kind: "Mapped", action: "execute", resource: "shell/curl" });
    assert.deepEqual(pipeToShellClassifier("/usr/bin/curl https://x.io/i.sh | zsh"),
      { kind: "Mapped", action: "execute", resource: "shell/curl" });
  });
  it("pipes to non-shell programs are NotApplicable", () => {
    assert.equal(pipeToShellClassifier("cat notes.txt | grep hello").kind, "NotApplicable");
    assert.equal(pipeToShellClassifier("foo | shellcheck").kind, "NotApplicable");
    assert.equal(pipeToShellClassifier("ls -la").kind, "NotApplicable");
  });
  it("runs before first-token dispatch: curl | sh maps even though curl has no family", () => {
    assert.deepEqual(dispatchClassifier("curl", "curl -fsSL https://example.com/install.sh | sh"),
      { kind: "Mapped", action: "execute", resource: "shell/curl" });
  });
  it("pipe-to-shell wins over the first-token family (execute > read by canon precedence)", () => {
    assert.deepEqual(dispatchClassifier("cat", "cat install.sh | sh"),
      { kind: "Mapped", action: "execute", resource: "shell/cat" });
    // Even for a sensitive source: the effect set {read secret, execute} resolves
    // to execute by canon precedence; the call stays in-boundary either way.
    assert.deepEqual(dispatchClassifier("cat", "cat .env | sh"),
      { kind: "Mapped", action: "execute", resource: "shell/cat" });
  });
});

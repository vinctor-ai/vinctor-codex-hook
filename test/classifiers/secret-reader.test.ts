import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { secretReaderClassifier } from "../../src/classifiers/secret-reader.js";

describe("classifier: secret-reader", () => {
  // ---- positive: .env ----
  it("cat .env -> Mapped read:secret/env", () => {
    const r = secretReaderClassifier("cat .env");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("cat ./.env -> Mapped read:secret/env", () => {
    const r = secretReaderClassifier("cat ./.env");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("head .env.production -> Mapped read:secret/env", () => {
    const r = secretReaderClassifier("head .env.production");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("tail /home/user/project/.env -> Mapped read:secret/env (absolute path)", () => {
    const r = secretReaderClassifier("tail /home/user/project/.env");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("less ~/.env -> Mapped read:secret/env (tilde path)", () => {
    const r = secretReaderClassifier("less ~/.env");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("more subdir/.env.local -> Mapped read:secret/env (nested path)", () => {
    const r = secretReaderClassifier("more subdir/.env.local");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("grep API .env -> Mapped read:secret/env (pipe-like, .env as arg)", () => {
    const r = secretReaderClassifier("grep API .env");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("cat .env | grep X -> Mapped read:secret/env (pipe in command)", () => {
    // The whole pipeline arrives as one normalized command string.
    const r = secretReaderClassifier("cat .env | grep X");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("awk '{print}' .env -> Mapped read:secret/env", () => {
    const r = secretReaderClassifier("awk '{print}' .env");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("sed -n '1p' .env.staging -> Mapped read:secret/env", () => {
    const r = secretReaderClassifier("sed -n '1p' .env.staging");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/env" });
  });

  // ---- positive: ssh ----
  it("cat ~/.ssh/id_rsa -> Mapped read:secret/ssh", () => {
    const r = secretReaderClassifier("cat ~/.ssh/id_rsa");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/ssh" });
  });
  it("cat /home/user/.ssh/id_ed25519 -> Mapped read:secret/ssh (absolute)", () => {
    const r = secretReaderClassifier("cat /home/user/.ssh/id_ed25519");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/ssh" });
  });
  it("cat server.pem -> Mapped read:secret/ssh (pem file)", () => {
    const r = secretReaderClassifier("cat server.pem");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/ssh" });
  });
  it("cat .ssh/id_ecdsa -> Mapped read:secret/ssh", () => {
    const r = secretReaderClassifier("cat .ssh/id_ecdsa");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/ssh" });
  });

  // ---- positive: aws ----
  it("cat ~/.aws/credentials -> Mapped read:secret/aws", () => {
    const r = secretReaderClassifier("cat ~/.aws/credentials");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/aws" });
  });
  it("cat /root/.aws/credentials -> Mapped read:secret/aws (absolute)", () => {
    const r = secretReaderClassifier("cat /root/.aws/credentials");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/aws" });
  });

  // ---- positive: gcp ----
  it("cat ~/.config/gcloud/legacy_credentials/foo/credentials.db -> Mapped read:secret/gcp", () => {
    const r = secretReaderClassifier("cat ~/.config/gcloud/legacy_credentials/foo/credentials.db");
    assert.deepEqual(r, { kind: "Mapped", action: "read", resource: "secret/gcp" });
  });

  // ---- false positives: must NOT match ----
  it("cat README.md -> NotApplicable (not a sensitive path)", () => {
    const r = secretReaderClassifier("cat README.md");
    assert.equal(r.kind, "NotApplicable");
  });
  it("ls -la -> NotApplicable (not a reader command)", () => {
    const r = secretReaderClassifier("ls -la");
    assert.equal(r.kind, "NotApplicable");
  });
  it("rm .env -> NotApplicable (not a reader command)", () => {
    const r = secretReaderClassifier("rm .env");
    assert.equal(r.kind, "NotApplicable");
  });
  it("echo .env >> .gitignore -> NotApplicable (echo is not a reader command)", () => {
    // echo is not in READER_COMMANDS
    const r = secretReaderClassifier("echo .env >> .gitignore");
    assert.equal(r.kind, "NotApplicable");
  });
  it("git status -> NotApplicable (not a reader command)", () => {
    const r = secretReaderClassifier("git status");
    assert.equal(r.kind, "NotApplicable");
  });
  it("cat src/app.ts -> NotApplicable (not sensitive)", () => {
    const r = secretReaderClassifier("cat src/app.ts");
    assert.equal(r.kind, "NotApplicable");
  });
  it("grep foo bar.txt -> NotApplicable (not sensitive)", () => {
    const r = secretReaderClassifier("grep foo bar.txt");
    assert.equal(r.kind, "NotApplicable");
  });

  // ---- critical: never returns RecognizedButUnclassified ----
  it("never returns RecognizedButUnclassified for a reader command with no sensitive path", () => {
    const r = secretReaderClassifier("cat package.json");
    assert.notEqual(r.kind, "RecognizedButUnclassified");
    assert.equal(r.kind, "NotApplicable");
  });
  it("never returns RecognizedButUnclassified for any known reader with innocuous args", () => {
    for (const cmd of ["head", "tail", "less", "more", "grep", "awk", "sed"]) {
      const r = secretReaderClassifier(`${cmd} somefile.txt`);
      assert.notEqual(r.kind, "RecognizedButUnclassified", `${cmd} returned RecognizedButUnclassified`);
    }
  });
});

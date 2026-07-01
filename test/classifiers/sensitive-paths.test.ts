import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifySensitivePath, normalizePathToken } from "../../src/classifiers/sensitive-paths.js";

describe("classifySensitivePath", () => {
  it("maps .env variants to secret/env", () => {
    for (const p of [".env", "project/.env", ".env.production", "a/b/.env.local"]) {
      assert.equal(classifySensitivePath(normalizePathToken(p)), "secret/env", p);
    }
  });
  it("maps ssh keys and pem to secret/ssh", () => {
    for (const p of ["home/u/.ssh/id_rsa", ".ssh/id_ed25519", "certs/server.pem"]) {
      assert.equal(classifySensitivePath(normalizePathToken(p)), "secret/ssh", p);
    }
  });
  it("maps aws credentials to secret/aws", () => {
    assert.equal(classifySensitivePath(normalizePathToken("home/u/.aws/credentials")), "secret/aws");
  });
  it("maps gcloud credentials to secret/gcp", () => {
    assert.equal(classifySensitivePath(normalizePathToken(".config/gcloud/x/credentials.db")), "secret/gcp");
  });
  it("returns null for non-sensitive paths", () => {
    for (const p of ["src/app.ts", "README.md", "package.json"]) {
      assert.equal(classifySensitivePath(normalizePathToken(p)), null, p);
    }
  });
});

describe("normalizePathToken", () => {
  it("strips ./ and leading /", () => {
    assert.equal(normalizePathToken("./.env"), ".env");
    assert.equal(normalizePathToken("/project/.env"), "project/.env");
  });
  it("expands ~/", () => {
    assert.match(normalizePathToken("~/.aws/credentials"), /\.aws\/credentials$/);
  });
});

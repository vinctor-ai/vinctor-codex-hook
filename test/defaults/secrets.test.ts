import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { secretsRules } from "../../src/defaults/secrets.js";
import { evaluateRule } from "../../src/mapping.js";

describe("defaults: secrets", () => {
  it("includes Read rules for .env variants", () => {
    const r = secretsRules.find((x) => x.tool === "Read" && x.pattern.includes(".env"));
    assert.ok(r);
  });
  it("matches .env via at least one Read rule", () => {
    const matched = secretsRules.some((r) => r.tool === "Read" && evaluateRule(r, "Read", "repo/.env"));
    assert.ok(matched);
  });
  it("matches ~/.ssh/id_rsa via at least one Read rule (post-normalization)", () => {
    const matched = secretsRules.some((r) => r.tool === "Read" && evaluateRule(r, "Read", "home/taeheon/.ssh/id_rsa"));
    assert.ok(matched);
  });
  it("matches `cat .env` via Bash rule", () => {
    const matched = secretsRules.some((r) => r.tool === "Bash" && evaluateRule(r, "Bash", "cat .env"));
    assert.ok(matched);
  });
  it("does not match unrelated repo file", () => {
    const matched = secretsRules.some((r) => r.tool === "Read" && evaluateRule(r, "Read", "repo/src/index.ts"));
    assert.ok(!matched);
  });
});

describe("defaults: secrets — write-side coverage", () => {
  const WRITE_TOOLS = ["Write", "Edit", "MultiEdit"] as const;

  for (const tool of WRITE_TOOLS) {
    it(`maps ${tool} of .env to write:secret/env`, () => {
      const hit = secretsRules.find(
        (r) => r.tool === tool && evaluateRule(r, tool, "repo/.env"),
      );
      assert.ok(hit, `expected a ${tool} rule to match repo/.env`);
      assert.equal(hit.action, "write");
      assert.equal(hit.resource, "secret/env");
    });

    it(`maps ${tool} of .env.production to write:secret/env`, () => {
      const matched = secretsRules.some(
        (r) => r.tool === tool && evaluateRule(r, tool, "repo/.env.production"),
      );
      assert.ok(matched);
    });

    it(`maps ${tool} of ~/.ssh/id_rsa to write:secret/ssh`, () => {
      const hit = secretsRules.find(
        (r) => r.tool === tool && evaluateRule(r, tool, "home/taeheon/.ssh/id_rsa"),
      );
      assert.ok(hit, `expected a ${tool} rule to match an ssh key`);
      assert.equal(hit.resource, "secret/ssh");
    });

    it(`maps ${tool} of .aws/credentials to write:secret/aws`, () => {
      const hit = secretsRules.find(
        (r) => r.tool === tool && evaluateRule(r, tool, "home/u/.aws/credentials"),
      );
      assert.ok(hit);
      assert.equal(hit.resource, "secret/aws");
    });

    it(`does not match an ordinary ${tool} of a source file`, () => {
      const matched = secretsRules.some(
        (r) => r.tool === tool && evaluateRule(r, tool, "repo/src/index.ts"),
      );
      assert.ok(!matched);
    });
  }

  it("every write-side secret rule uses action 'write' and a secret/ resource", () => {
    const writeRules = secretsRules.filter((r) =>
      (["Write", "Edit", "MultiEdit"] as const).includes(r.tool as never),
    );
    assert.ok(writeRules.length > 0);
    for (const r of writeRules) {
      assert.equal(r.action, "write");
      assert.ok(r.resource.startsWith("secret/"), `${r.resource} should be a secret/ resource`);
    }
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { infraOpsRules } from "../../src/defaults/infra-ops.js";
import { evaluateRule } from "../../src/mapping.js";

const bashMatches = (input: string) =>
  infraOpsRules.some((r) => r.tool === "Bash" && evaluateRule(r, "Bash", input));

describe("defaults: infra-ops (skeletal)", () => {
  it("matches representative kubectl apply", () => {
    assert.ok(bashMatches("kubectl apply -f deploy.yaml"));
  });
  it("matches representative terraform apply", () => {
    assert.ok(bashMatches("terraform apply"));
  });
  it("does not pretend to cover the whole infra surface", () => {
    assert.ok(!bashMatches("aws s3 ls"));
    assert.ok(!bashMatches("vercel deploy"));
  });
});

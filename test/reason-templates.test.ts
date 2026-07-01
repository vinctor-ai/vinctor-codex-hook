import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { DENY_TEMPLATES } from "../src/output.js";
import { allOutputFactoryResults } from "./helpers/all-outputs.js";

const FIXED_SET: ReadonlySet<string> = new Set(Object.values(DENY_TEMPLATES));

describe("invariant: reason templates are a fixed verbatim set", () => {
  it("every output's permissionDecisionReason is in the fixed set (or absent for allow)", () => {
    for (const o of allOutputFactoryResults()) {
      const reason = o.hookSpecificOutput.permissionDecisionReason;
      if (reason === undefined) {
        assert.equal(o.hookSpecificOutput.permissionDecision, "allow");
        continue;
      }
      assert.ok(FIXED_SET.has(reason), `reason "${reason}" not in fixed set`);
    }
  });

  it("no DENY_TEMPLATES value contains a '${' interpolation marker", () => {
    for (const v of Object.values(DENY_TEMPLATES)) {
      assert.ok(!v.includes("${"), `template has interpolation: ${v}`);
    }
  });
});

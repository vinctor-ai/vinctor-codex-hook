import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { DENY_TEMPLATES } from "../src/output.js";
import { allOutputFactoryResults } from "./helpers/all-outputs.js";

describe("invariant: no grant_ref disclosure", () => {
  it("no fixed template contains a grt_ substring", () => {
    for (const v of Object.values(DENY_TEMPLATES)) {
      assert.doesNotMatch(v, /grt_/);
    }
  });
  it("every output factory result has no grt_ substring", () => {
    for (const o of allOutputFactoryResults()) {
      assert.doesNotMatch(JSON.stringify(o), /grt_/);
    }
  });
});

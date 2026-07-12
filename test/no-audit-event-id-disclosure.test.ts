import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { DENY_TEMPLATES } from "../src/output.js";
import { allOutputFactoryResults } from "./helpers/all-outputs.js";

describe("invariant: no audit_event_id disclosure", () => {
  it("no fixed template contains an evt_ substring", () => {
    for (const v of Object.values(DENY_TEMPLATES)) {
      assert.doesNotMatch(v, /evt_/);
    }
  });
  it("every output factory result has no evt_ substring", () => {
    for (const o of allOutputFactoryResults()) {
      assert.doesNotMatch(JSON.stringify(o), /evt_/);
    }
  });
});

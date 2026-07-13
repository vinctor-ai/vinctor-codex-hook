import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { permit, abstain, decision, denyFor } from "../src/output.js";
import { MalformedPayloadError, ServiceUnavailableError, ActionDeniedError } from "../src/errors.js";

describe("output formatter", () => {
  it("permit emits nothing because bare allow is unsupported by Codex", () => {
    assert.deepEqual(permit(), { emit: "abstain" });
  });

  it("abstain emits nothing (no JSON envelope) — Codex has no `ask`", () => {
    assert.deepEqual(abstain(), { emit: "abstain" });
  });

  it("decision wraps an envelope for serialization", () => {
    const output = denyFor(new MalformedPayloadError("x"));
    assert.deepEqual(decision(output), { emit: "decision", output });
  });

  it("deny uses the verbatim template for each code", () => {
    assert.equal(
      denyFor(new MalformedPayloadError("x")).hookSpecificOutput.permissionDecisionReason,
      "Denied by Vinctor authorization: malformed_payload.",
    );
    assert.equal(
      denyFor(new ServiceUnavailableError("x")).hookSpecificOutput.permissionDecisionReason,
      "Denied by Vinctor authorization (fail-closed): this tool call was classified and routed for authorization, but the Vinctor service could not be reached. Vinctor denies what it cannot evaluate, so this is a fail-closed deny — not a setup error. Restore the service to get a real allow/deny decision.",
    );
    assert.equal(
      denyFor(new ActionDeniedError("x")).hookSpecificOutput.permissionDecisionReason,
      "Denied by Vinctor authorization: action_denied.",
    );
  });

  it("deny permissionDecision is always exactly \"deny\" (never \"ask\")", () => {
    assert.equal(denyFor(new MalformedPayloadError("x")).hookSpecificOutput.permissionDecision, "deny");
  });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  HookError,
  MalformedPayloadError,
  ParseUnsafeError,
  InvalidConfigError,
  MissingAuthEnvError,
  ServiceUnavailableError,
  ActionDeniedError,
} from "../src/errors.js";

describe("error hierarchy", () => {
  it("all hook errors extend HookError", () => {
    assert.ok(new MalformedPayloadError("x") instanceof HookError);
    assert.ok(new ParseUnsafeError("x") instanceof HookError);
    assert.ok(new InvalidConfigError("x") instanceof HookError);
    assert.ok(new MissingAuthEnvError("x") instanceof HookError);
    assert.ok(new ServiceUnavailableError("x") instanceof HookError);
    assert.ok(new ActionDeniedError("x") instanceof HookError);
  });

  it("each error carries the stable spec §9.2 code", () => {
    assert.equal(new MalformedPayloadError("x").code, "malformed_payload");
    assert.equal(new ParseUnsafeError("x").code, "parse_unsafe");
    assert.equal(new InvalidConfigError("x").code, "invalid_config");
    assert.equal(new MissingAuthEnvError("x").code, "missing_auth_env");
    assert.equal(new ServiceUnavailableError("x").code, "service_unavailable");
    assert.equal(new ActionDeniedError("x").code, "action_denied");
  });
});

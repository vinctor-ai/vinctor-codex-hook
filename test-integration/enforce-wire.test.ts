import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { enforce } from "../src/enforce-client.js";

const endpoint = process.env.VINCTOR_E2E_ENDPOINT;
const agentKey = process.env.VINCTOR_E2E_AGENT_KEY;
const grantRef = process.env.VINCTOR_E2E_GRANT_REF;

const haveEnv = endpoint && agentKey && grantRef;

describe("integration: /v1/enforce wire", { skip: !haveEnv }, () => {
  it("returns permit for a permitted action on a real service", async () => {
    await assert.doesNotReject(
      enforce(
        { action: "execute", resource: "ci/test" },
        { VINCTOR_ENDPOINT: endpoint!, VINCTOR_AGENT_KEY: agentKey!, VINCTOR_GRANT_REF: grantRef! },
      ),
    );
  });
});

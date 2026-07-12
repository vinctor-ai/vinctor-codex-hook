import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Codex plugin package", () => {
  it("ships a manifest and the default hooks/hooks.json entrypoint", () => {
    const manifest = JSON.parse(readFileSync(".codex-plugin/plugin.json", "utf8"));
    const hooks = JSON.parse(readFileSync("hooks/hooks.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    assert.equal(manifest.name, "vinctor-codex-hook");
    // Parity, not a hardcode: a version bump that misses the plugin manifest
    // must FAIL here (a hardcoded pin let the 0.1.0/0.1.1 skew pass CI once).
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.hooks, undefined);

    const handler = hooks.hooks.PreToolUse[0];
    assert.equal(
      handler.matcher,
      "Bash|apply_patch|Edit|Write|mcp__.*",
    );
    assert.deepEqual(handler.hooks, [
      {
        type: "command",
        command: "${PLUGIN_ROOT}/dist/src/cli.js",
        timeout: 30,
        statusMessage: "Checking Vinctor authorization",
      },
    ]);
  });
});

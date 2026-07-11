// Regression: the npm bin is installed as a SYMLINK to dist/src/cli.js. A naive
// `import.meta.url === file://${argv[1]}` main guard doesn't fire through the
// symlink, so the published binary would exit 0 with no output — for a
// fail-closed hook that is a silent fail-OPEN. The guard must realpath argv[1].
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("CLI still runs when invoked through a symlink (npm bin shim)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vinctor-bin-"));
  try {
    const link = join(dir, "vinctor-codex-hook");
    symlinkSync(resolve("dist/src/cli.js"), link);
    const out = execFileSync(process.execPath, [link, "--version"], { encoding: "utf8" });
    assert.match(out.trim(), /\d+\.\d+\.\d+/, "expected a version on stdout via the symlinked bin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

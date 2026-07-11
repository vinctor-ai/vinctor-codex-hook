import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { handleCliFlags, dispatchCli } from "../src/cli.js";

describe("CLI flag handling", () => {
  it("--version prints a semver-like string and returns true", () => {
    let out = "";
    const handled = handleCliFlags(["node", "cli.js", "--version"], (s) => { out += s; });
    assert.ok(handled);
    assert.match(out, /\d+\.\d+\.\d+/);
  });

  it("-v alias also prints version", () => {
    let out = "";
    assert.ok(handleCliFlags(["node", "cli.js", "-v"], (s) => { out += s; }));
    assert.match(out, /\d+\.\d+\.\d+/);
  });

  it("--help mentions env vars incl. VINCTOR_CODEX_HOOK_CONFIG and stdin", () => {
    let out = "";
    const handled = handleCliFlags(["node", "cli.js", "--help"], (s) => { out += s; });
    assert.ok(handled);
    assert.ok(out.includes("VINCTOR_ENDPOINT"));
    assert.ok(out.includes("VINCTOR_AGENT_KEY"));
    assert.ok(out.includes("VINCTOR_GRANT_REF"));
    assert.ok(out.includes("VINCTOR_CODEX_HOOK_CONFIG"));
    assert.ok(out.includes("VINCTOR_HOOK_DEBUG"));
    assert.ok(out.toLowerCase().includes("stdin"));
    assert.ok(out.includes("Codex"));
    assert.ok(!out.includes("hookSpecificOutput"));
  });

  it("no flags → returns false (hook mode proceeds)", () => {
    let out = "";
    assert.ok(!handleCliFlags(["node", "cli.js"], (s) => { out += s; }));
    assert.equal(out, "");
  });

  it("--version does not emit hook JSON", () => {
    let out = "";
    handleCliFlags(["node", "cli.js", "--version"], (s) => { out += s; });
    assert.ok(!out.includes("hookSpecificOutput"));
    assert.ok(!out.includes("permissionDecision"));
  });
});

function cap() {
  const out: string[] = [];
  return { out, write: (s: string) => out.push(s) };
}
const reader = (files: Record<string, string>, unreadable: string[] = []) => (p: string): string => {
  if (unreadable.includes(p)) { const e = new Error("EACCES") as NodeJS.ErrnoException; e.code = "EACCES"; throw e; }
  if (!(p in files)) { const e = new Error("ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; }
  return files[p]!;
};
const existsOf = (files: Record<string, string>, unreadable: string[] = []) => (p: string): boolean =>
  p in files || unreadable.includes(p);

const baseDeps = (files: Record<string, string>, opts: { unreadable?: string[]; env?: Record<string, string | undefined>; stdin?: string } = {}) => ({
  stdout: undefined as unknown as (s: string) => void,
  env: opts.env ?? {},
  readFile: reader(files, opts.unreadable ?? []),
  exists: existsOf(files, opts.unreadable ?? []),
  readStdin: async () => opts.stdin ?? "",
  fetchFn: (async () => new Response("", { status: 200 })) as typeof fetch,
});

describe("dispatchCli — subcommands", () => {
  it("validate valid → exit 0, text output", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate", "c.json"], ...baseDeps({ "c.json": JSON.stringify({ version: 1, rules: [] }) }), stdout: o.write });
    assert.equal(code, 0);
    assert.match(o.out.join(""), /✓/);
  });

  it("validate invalid → exit 1", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate", "c.json"], ...baseDeps({ "c.json": JSON.stringify({ version: 1, rules: [{ tool: "Bash", matchType: "exact", pattern: "x", action: "yell", resource: "y" }] }) }), stdout: o.write });
    assert.equal(code, 1);
  });

  it("validate present-but-unreadable → exit 2", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate", "locked.json"], ...baseDeps({}, { unreadable: ["locked.json"] }), stdout: o.write });
    assert.equal(code, 2);
    assert.match(o.out.join(""), /could not read/);
  });

  it("validate with NO path + default config absent → exit 0 with built-ins note", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate"], ...baseDeps({}), stdout: o.write });
    assert.equal(code, 0);
    assert.match(o.out.join(""), /built-in defaults only/);
  });

  it("validate with an EXPLICIT missing path → exit 2 (not a silent green)", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate", "typo.json"], ...baseDeps({}), stdout: o.write });
    assert.equal(code, 2);
    assert.match(o.out.join(""), /not found/);
  });

  it("validate explicit missing path --json → exit 2, structured error", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate", "typo.json", "--json"], ...baseDeps({}), stdout: o.write });
    assert.equal(code, 2);
    const parsed = JSON.parse(o.out.join(""));
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors[0].message, /not found/);
  });

  it("validate --json → exit 1 and stdout is exactly JSON.stringify(result)", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "validate", "c.json", "--json"], ...baseDeps({ "c.json": JSON.stringify({ version: 1, rules: [{ tool: "Bash", matchType: "exact", pattern: "x", action: "yell", resource: "y" }] }) }), stdout: o.write });
    assert.equal(code, 1);
    const out = o.out.join("");
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.equal(out, JSON.stringify(parsed));
  });

  it("explain mapped (Bash npm publish) → exit 0", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "explain", "e.json"], ...baseDeps({ "e.json": JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }) }), stdout: o.write });
    assert.equal(code, 0);
    assert.match(o.out.join(""), /MAPPED/);
  });

  it("explain mapped --json → resource npm/package", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "explain", "e.json", "--json"], ...baseDeps({ "e.json": JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }) }), stdout: o.write });
    assert.equal(code, 0);
    const parsed = JSON.parse(o.out.join(""));
    assert.equal(parsed.decision, "mapped");
    assert.equal(parsed.resource, "npm/package");
  });

  it("explain apply_patch editing .env → mapped write:secret/env", async () => {
    const o = cap();
    const ev = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: config/.env\n+X=1\n*** End Patch" } });
    const code = await dispatchCli({ argv: ["node", "cli", "explain", "e.json", "--json"], ...baseDeps({ "e.json": ev }), stdout: o.write });
    assert.equal(code, 0);
    const parsed = JSON.parse(o.out.join(""));
    assert.equal(parsed.decision, "mapped");
    assert.equal(parsed.action, "write");
    assert.equal(parsed.resource, "secret/env");
  });

  it("explain unmapped → exit 0 with abstain wording", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "explain", "e.json"], ...baseDeps({ "e.json": JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la" } }) }), stdout: o.write });
    assert.equal(code, 0);
    assert.match(o.out.join(""), /UNMAPPED/);
    assert.match(o.out.join(""), /abstains/);
  });

  it("explain missing event file → exit 2", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "explain", "missing.json"], ...baseDeps({}), stdout: o.write });
    assert.equal(code, 2);
  });

  it("explain malformed event --json → exit 2 parse_error", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "explain", "e.json", "--json"], ...baseDeps({ "e.json": JSON.stringify({ hook_event_name: "PreToolUse" }) }), stdout: o.write });
    assert.equal(code, 2);
    assert.equal(JSON.parse(o.out.join("")).decision, "parse_error");
  });

  it("explain no positional path → exit 2", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "explain"], ...baseDeps({}), stdout: o.write });
    assert.equal(code, 2);
  });

  it("explain invalid config (via VINCTOR_CODEX_HOOK_CONFIG) → exit 1 config_error", async () => {
    const o = cap();
    const code = await dispatchCli({
      argv: ["node", "cli", "explain", "e.json"],
      ...baseDeps({
        "e.json": JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }),
        "c.json": JSON.stringify({ version: 1, rules: [{ tool: "Bash", matchType: "exact", pattern: "x", action: "yell", resource: "y" }] }),
      }, { env: { VINCTOR_CODEX_HOOK_CONFIG: "c.json" } }),
      stdout: o.write,
    });
    assert.equal(code, 1);
  });

  it("no subcommand → hook mode (mapped event emits a decision, exit 0)", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli"], ...baseDeps({}, { stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }) }), stdout: o.write });
    assert.equal(code, 0);
    assert.match(o.out.join(""), /permissionDecision/);
  });

  it("no subcommand → hook mode with an unmapped event emits empty stdout (abstain)", async () => {
    const o = cap();
    const code = await dispatchCli({ argv: ["node", "cli"], ...baseDeps({}, { stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }) }), stdout: o.write });
    assert.equal(code, 0);
    assert.equal(o.out.join(""), "");
  });

  it("unknown subcommand → exit 2 with stderr usage; no hook JSON, no stdin read", async () => {
    const o = cap();
    const err = cap();
    let stdinRead = false;
    const code = await dispatchCli({
      argv: ["node", "cli", "list-defaults"],
      ...baseDeps({}),
      stdout: o.write,
      stderr: err.write,
      readStdin: async () => { stdinRead = true; return ""; },
    });
    assert.equal(code, 2);
    assert.match(err.out.join(""), /list-defaults/);
    assert.match(err.out.join(""), /validate|explain/);
    assert.doesNotMatch(o.out.join(""), /permissionDecision/);
    assert.equal(stdinRead, false);
  });

  it("a typo'd subcommand also exits 2, not hook mode", async () => {
    const o = cap();
    const err = cap();
    const code = await dispatchCli({ argv: ["node", "cli", "valdiate"], ...baseDeps({}), stdout: o.write, stderr: err.write });
    assert.equal(code, 2);
    assert.doesNotMatch(o.out.join(""), /permissionDecision/);
  });

  it("hook mode: VINCTOR_HOOK_DEBUG writes a config diagnostic to stderr, not stdout", async () => {
    const o = cap();
    const err = cap();
    const code = await dispatchCli({
      argv: ["node", "cli"],
      ...baseDeps({}, {
        env: { VINCTOR_HOOK_DEBUG: "1", VINCTOR_CODEX_HOOK_CONFIG: "my-config.json" },
        stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }),
      }),
      stdout: o.write,
      stderr: err.write,
    });
    assert.equal(code, 0);
    assert.match(err.out.join(""), /my-config\.json/);
    assert.doesNotMatch(o.out.join(""), /my-config\.json/);
    assert.match(o.out.join(""), /permissionDecision/);
  });

  it("hook mode: no stderr diagnostic when VINCTOR_HOOK_DEBUG is unset", async () => {
    const o = cap();
    const err = cap();
    const code = await dispatchCli({
      argv: ["node", "cli"],
      ...baseDeps({}, { env: { VINCTOR_CODEX_HOOK_CONFIG: "my-config.json" }, stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }) }),
      stdout: o.write,
      stderr: err.write,
    });
    assert.equal(code, 0);
    assert.equal(err.out.join(""), "");
  });

  it("hook mode: debug diagnostic never includes secret env values", async () => {
    const o = cap();
    const err = cap();
    await dispatchCli({
      argv: ["node", "cli"],
      ...baseDeps({}, {
        env: { VINCTOR_HOOK_DEBUG: "1", VINCTOR_AGENT_KEY: "aak_PROBE_secret", VINCTOR_GRANT_REF: "grt_PROBE_secret" },
        stdin: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm publish" } }),
      }),
      stdout: o.write,
      stderr: err.write,
    });
    const all = err.out.join("") + o.out.join("");
    assert.doesNotMatch(all, /aak_PROBE_secret/);
    assert.doesNotMatch(all, /grt_PROBE_secret/);
  });
});

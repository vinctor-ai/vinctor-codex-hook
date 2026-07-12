#!/usr/bin/env node
import { handleEvent } from "./hook.js";
import { decision, denyFor } from "./output.js";
import { MalformedPayloadError } from "./errors.js";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runValidate } from "./commands/validate.js";
import { runExplain } from "./commands/explain.js";
import { runDoctor, type DoctorInput } from "./commands/doctor.js";
import { renderValidateText, renderExplainText, renderDoctorText } from "./commands/render.js";
import type { HookResponse } from "./types.js";

export type CliDeps = {
  stdin: string;
  stdout: (s: string) => void;
  env: Record<string, string | undefined>;
  configPath: string;
  fetchFn: typeof fetch;
};

/** Read the package version at runtime from package.json (no hardcoded duplicate). */
function getPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // Resolve relative to this file: dist/src/cli.js -> ../../package.json
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Read the plugin manifest version, or null if unreadable (doctor parity check). */
function getManifestVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require("../../.codex-plugin/plugin.json") as { version?: string };
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

/** Best-effort endpoint reachability: any HTTP answer = reachable; no auth sent. */
async function probeEndpoint(endpoint: string | undefined, fetchFn: typeof fetch): Promise<boolean | null> {
  if (endpoint === undefined || endpoint === "") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    await fetchFn(endpoint, { method: "HEAD", signal: controller.signal });
    return true; // TCP + HTTP answered (even 4xx/5xx counts as reachable)
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Serialize a hook response: a decision becomes JSON; an abstain emits nothing. */
function emitResponse(res: HookResponse, stdout: (s: string) => void): void {
  if (res.emit === "decision") {
    stdout(JSON.stringify(res.output));
  } else {
    // Abstain: empty stdout + exit 0 → Codex falls back to its native approval flow.
    stdout("");
  }
}

/**
 * Handle --version/-v and --help/-h flags.
 * Returns true if a flag was handled (caller should exit 0), false otherwise.
 *
 * Exported for unit testing. Does NOT call process.exit itself.
 */
export function handleCliFlags(
  argv: string[],
  stdout: (s: string) => void,
): boolean {
  const args = argv.slice(2); // strip "node" and script path
  if (args.includes("--version") || args.includes("-v")) {
    stdout(getPackageVersion());
    return true;
  }
  if (args.includes("--help") || args.includes("-h")) {
    const version = getPackageVersion();
    stdout([
      `vinctor-codex-hook ${version}`,
      "",
      "Hook mode (default): reads a Codex CLI PreToolUse JSON event on stdin,",
      "writes a permission decision JSON object on stdout. An unclassifiable call",
      "emits nothing (Codex's native approval flow applies).",
      "",
      "Usage:",
      "  vinctor-codex-hook                       Hook mode (reads stdin)",
      "  vinctor-codex-hook validate [PATH]       Lint a config file [--json]",
      "  vinctor-codex-hook explain <EVENT>       Show how an event maps [--json]",
      "  vinctor-codex-hook doctor                Self-check install + wiring [--json]",
      "  vinctor-codex-hook --version | --help",
      "",
      "Environment variables:",
      "  VINCTOR_ENDPOINT                    Authorization service base URL",
      "  VINCTOR_AGENT_KEY                   Agent API key (aak_...)",
      "  VINCTOR_GRANT_REF                   Grant reference (grt_...)",
      "  VINCTOR_BOUNDARY_ID                 Optional Vinctor boundary id",
      "  VINCTOR_CODEX_HOOK_CONFIG           Path to hook config JSON",
      "                                      (default: .vinctor/codex-hook.json)",
      "  VINCTOR_HOOK_DEBUG                  If set, write one config-path",
      "                                      diagnostic line to stderr per event",
    ].join("\n"));
    return true;
  }
  return false;
}

export async function runCli(deps: CliDeps): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(deps.stdin);
  } catch {
    emitResponse(decision(denyFor(new MalformedPayloadError("stdin is not JSON"))), deps.stdout);
    return;
  }
  const res = await handleEvent(input, {
    env: deps.env,
    fetchFn: deps.fetchFn,
    configPath: deps.configPath,
  });
  emitResponse(res, deps.stdout);
}

export type DispatchDeps = {
  argv: string[];
  stdout: (s: string) => void;
  env: Record<string, string | undefined>;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  readStdin: () => Promise<string>;
  fetchFn: typeof fetch;
  // Optional diagnostic channel. Used only for the VINCTOR_HOOK_DEBUG line in
  // hook mode; defaults to a no-op so the hook protocol (stdout) is unaffected.
  stderr?: (s: string) => void;
  // Doctor-only runtime facts (supplied by the real entrypoint; optional so
  // existing callers/tests are unaffected — doctor falls back to process.*).
  binPath?: string | null;
  nodeVersion?: string;
};

/** Read a file, returning null instead of throwing (doctor best-effort reads). */
function safeRead(readFile: (p: string) => string, path: string): string | null {
  try {
    return readFile(path);
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG = ".vinctor/codex-hook.json";

/** The config path from a non-empty env override, else the default. */
function configPathFromEnv(env: Record<string, string | undefined>): string {
  const override = env.VINCTOR_CODEX_HOOK_CONFIG;
  return override && override.length > 0 ? override : DEFAULT_CONFIG;
}

export async function dispatchCli(deps: DispatchDeps): Promise<number> {
  const sub = deps.argv[2];
  const json = deps.argv.includes("--json");
  const positional = deps.argv.slice(3).filter((a) => !a.startsWith("-"));

  if (sub === "validate") {
    const explicitPath = positional[0];
    const configPath = explicitPath ?? configPathFromEnv(deps.env);
    // An explicitly-named path that doesn't exist is a mistake (e.g. a typo) — exit
    // 2, not a green "built-ins only". Only the *default* path being absent is OK
    // (that genuinely means "no config; built-ins only").
    if (explicitPath !== undefined && !deps.exists(configPath)) {
      const msg = `config file not found: ${configPath}`;
      deps.stdout(json
        ? JSON.stringify({ command: "validate", configPath, ok: false, ruleCount: 0, errors: [{ ruleIndex: null, field: null, message: msg }] })
        : `✗ ${msg}`);
      return 2;
    }
    // The CLI owns the filesystem: absent (exists=false) → raw null; present but
    // unreadable → exit 2; present → pass the contents to the pure runValidate.
    let raw: string | null;
    try {
      raw = deps.exists(configPath) ? deps.readFile(configPath) : null;
    } catch (e) {
      const msg = `could not read ${configPath}: ${(e as Error).message}`;
      deps.stdout(json
        ? JSON.stringify({ command: "validate", configPath, ok: false, ruleCount: 0, errors: [{ ruleIndex: null, field: null, message: msg }] })
        : `✗ ${msg}`);
      return 2;
    }
    const res = runValidate({ configPath, raw });
    deps.stdout(json ? JSON.stringify(res) : renderValidateText(res));
    return res.ok ? 0 : 1;
  }

  if (sub === "explain") {
    const eventPath = positional[0];
    if (!eventPath) {
      deps.stdout(json ? JSON.stringify({ command: "explain", decision: "usage_error", message: "explain requires an event file path" }) : "explain requires an event file path");
      return 2;
    }
    try {
      const res = runExplain({
        eventPath,
        configPath: DEFAULT_CONFIG,
        env: deps.env,
        readFile: deps.readFile,
      });
      deps.stdout(json ? JSON.stringify(res) : renderExplainText(res));
      if (res.decision === "parse_error") return 2;
      if (res.decision === "config_error") return 1;
      return 0;
    } catch (e) {
      deps.stdout(json ? JSON.stringify({ command: "explain", decision: "usage_error", message: (e as Error).message }) : `Could not read event file: ${(e as Error).message}`);
      return 2;
    }
  }

  if (sub === "doctor") {
    // The CLI owns the impure inputs; runDoctor is pure over the collected data.
    const home = deps.env.HOME ?? deps.env.USERPROFILE;
    const candidatePaths = [
      ...(home ? [`${home}/.codex/hooks.json`] : []),
      ".codex/hooks.json",
    ];
    const configCandidates = candidatePaths.map((path) => ({
      path,
      raw: deps.exists(path) ? safeRead(deps.readFile, path) : null,
    }));
    const endpointReachable = await probeEndpoint(deps.env.VINCTOR_ENDPOINT, deps.fetchFn);
    const inp: DoctorInput = {
      binPath: deps.binPath ?? null,
      nodeVersion: deps.nodeVersion ?? process.version,
      packageVersion: getPackageVersion(),
      manifestVersion: getManifestVersion(),
      env: deps.env,
      configCandidates,
      endpointReachable,
    };
    const report = runDoctor(inp);
    deps.stdout(json ? JSON.stringify(report) : renderDoctorText(report));
    return report.ok ? 0 : 1;
  }

  // A bare token in argv[2] that isn't a known subcommand (and isn't a flag) is a
  // mistake — a typo or a command that doesn't exist. Do NOT silently fall into
  // hook mode: that would read stdin and emit a confusing malformed_payload
  // decision. Fail fast with a helpful message and exit 2.
  if (sub !== undefined && !sub.startsWith("-")) {
    if (deps.stderr) {
      deps.stderr(`vinctor-codex-hook: unknown command "${sub}".`);
      deps.stderr(`Valid commands: validate [PATH] [--json], explain <EVENT> [--json], --version, --help.`);
      deps.stderr(`Run with no command to act as a Codex CLI PreToolUse hook (reads stdin).`);
    }
    return 2;
  }

  // No subcommand → hook mode.
  const configPath = configPathFromEnv(deps.env);
  // Optional, opt-in diagnostic: when VINCTOR_HOOK_DEBUG is set, write one line
  // to stderr naming the resolved config path and whether it was found. This is
  // gated behind a flag (not emitted on every event) and goes to stderr only, so
  // the stdout hook protocol is byte-identical. It never echoes secret env values.
  if (isTruthy(deps.env.VINCTOR_HOOK_DEBUG) && deps.stderr) {
    const found = deps.exists(configPath) ? "found" : "absent";
    deps.stderr(`vinctor-codex-hook: config path "${configPath}" (${found})`);
  }
  const stdin = await deps.readStdin();
  await runCli({
    stdin,
    stdout: deps.stdout,
    env: deps.env,
    configPath,
    fetchFn: deps.fetchFn,
  });
  return 0;
}

function isTruthy(v: string | undefined): boolean {
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// Run as a CLI when invoked directly OR via a bin symlink (npm installs the
// bin as a symlink, so argv[1] must be realpath'd before comparing — a naive
// `file://${argv[1]}` guard silently no-ops the published binary, which for a
// fail-closed hook would be a fail-OPEN).
const invokedAsMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedAsMain) {
  // --version / --help still short-circuit (no subcommand semantics).
  if (handleCliFlags(process.argv, (s) => process.stdout.write(s + "\n"))) {
    process.exit(0);
  }
  const code = await dispatchCli({
    argv: process.argv,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s + "\n"),
    env: process.env,
    readFile: (p) => readFileSync(p, "utf8"),
    exists: (p) => existsSync(p),
    readStdin,
    fetchFn: fetch,
    binPath: (() => {
      try {
        return process.argv[1] ? realpathSync(process.argv[1]) : null;
      } catch {
        return null;
      }
    })(),
    nodeVersion: process.version,
  });
  process.exit(code);
}

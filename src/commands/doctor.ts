import { parseEvent } from "../parser.js";
import { resolve } from "../mapping.js";
import type { HookConfig } from "../types.js";

/**
 * `doctor` — installation/wiring self-check. It verifies everything that can be
 * checked from OUTSIDE a live Codex session (resolved bin, node, version parity,
 * a discovered hook-config entry, VINCTOR_* env, endpoint reachability, and a
 * classifier smoke) and states clearly what it CANNOT prove: that Codex has
 * trusted the hook and is actually firing it (only `/hooks` + an interactive run
 * can confirm that — headless `codex exec` silently skips untrusted hooks).
 *
 * runDoctor is pure: the CLI layer reads the filesystem / probes the network and
 * passes the results in.
 */

export type CheckStatus = "pass" | "warn" | "fail";
export type DoctorCheck = { name: string; status: CheckStatus; detail: string };

export type DoctorInput = {
  /** Absolute realpath of this CLI bin (for pasting into hooks.json), or null. */
  binPath: string | null;
  /** process.version, e.g. "v20.11.0". */
  nodeVersion: string;
  /** package.json version. */
  packageVersion: string;
  /** .codex-plugin/plugin.json version, or null if unreadable. */
  manifestVersion: string | null;
  env: Record<string, string | undefined>;
  /** Known Codex hook-config locations and their contents (raw null = absent). */
  configCandidates: Array<{ path: string; raw: string | null }>;
  /** Endpoint reachability: true/false when probed, null when unset/not probed. */
  endpointReachable: boolean | null;
};

export type DoctorReport = {
  command: "doctor";
  checks: DoctorCheck[];
  ok: boolean;
  caveat: string;
};

const CAVEAT =
  "doctor cannot prove Codex has trusted or is firing the hook. Confirm with " +
  "`/hooks` in an interactive session and watch a mapped command show " +
  "`hook: PreToolUse` — headless `codex exec` silently skips untrusted hooks.";

const REQUIRED_ENV = ["VINCTOR_ENDPOINT", "VINCTOR_AGENT_KEY", "VINCTOR_GRANT_REF"] as const;
const DOCUMENTED_MATCHER = "Bash|apply_patch|Edit|Write|mcp__.*";

export function runDoctor(inp: DoctorInput): DoctorReport {
  const checks: DoctorCheck[] = [
    checkCli(inp),
    checkNode(inp),
    checkVersionParity(inp),
    checkHookConfig(inp),
    checkEnv(inp),
    checkService(inp),
    checkClassifierSmoke(),
  ];
  const ok = checks.every((c) => c.status !== "fail");
  return { command: "doctor", checks, ok, caveat: CAVEAT };
}

function checkCli(inp: DoctorInput): DoctorCheck {
  if (inp.binPath) {
    return { name: "cli-resolved", status: "pass", detail: `hook command: ${inp.binPath}` };
  }
  return { name: "cli-resolved", status: "warn", detail: "could not resolve the bin path" };
}

function checkNode(inp: DoctorInput): DoctorCheck {
  const major = Number.parseInt(inp.nodeVersion.replace(/^v/, "").split(".")[0] ?? "", 10);
  if (Number.isFinite(major) && major >= 20) {
    return { name: "node-version", status: "pass", detail: `${inp.nodeVersion} (>= 20)` };
  }
  return { name: "node-version", status: "fail", detail: `${inp.nodeVersion} (requires >= 20)` };
}

function checkVersionParity(inp: DoctorInput): DoctorCheck {
  if (inp.manifestVersion === null) {
    return { name: "version-parity", status: "warn", detail: `package ${inp.packageVersion}; plugin manifest not found` };
  }
  if (inp.manifestVersion === inp.packageVersion) {
    return { name: "version-parity", status: "pass", detail: `package and plugin manifest agree (${inp.packageVersion})` };
  }
  return {
    name: "version-parity",
    status: "fail",
    detail: `package ${inp.packageVersion} != plugin manifest ${inp.manifestVersion}`,
  };
}

function checkHookConfig(inp: DoctorInput): DoctorCheck {
  for (const cand of inp.configCandidates) {
    if (cand.raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(cand.raw);
    } catch {
      return { name: "hook-config", status: "warn", detail: `config at ${cand.path} is not valid JSON` };
    }
    const matcher = findHookMatcher(parsed, inp.binPath);
    if (matcher === null) continue;
    if (matcher.trim() === ".*") {
      return {
        name: "hook-config",
        status: "warn",
        detail:
          `${cand.path} wires the hook but the matcher is \`.*\` — that fail-closes ` +
          `every unrecognized/future Codex tool. Use \`${DOCUMENTED_MATCHER}\`.`,
      };
    }
    if (!matcher.includes("Bash")) {
      return {
        name: "hook-config",
        status: "warn",
        detail: `${cand.path} wires the hook but the matcher (${matcher}) omits Bash`,
      };
    }
    return { name: "hook-config", status: "pass", detail: `wired in ${cand.path} (matcher: ${matcher})` };
  }
  return {
    name: "hook-config",
    status: "warn",
    detail:
      "no ~/.codex/hooks.json or ./.codex/hooks.json entry references this hook. " +
      "If you installed it as a marketplace plugin or use a config.toml hook table, " +
      "that is fine — verify with `/hooks`.",
  };
}

/**
 * Return the PreToolUse matcher of the config entry whose command references this
 * hook (by bin basename, the resolved bin path, or the built dist/src/cli.js), or
 * null if no entry references it.
 */
function findHookMatcher(parsed: unknown, binPath: string | null): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (typeof hooks !== "object" || hooks === null) return null;
  const pre = (hooks as { PreToolUse?: unknown }).PreToolUse;
  if (!Array.isArray(pre)) return null;
  for (const entry of pre) {
    if (typeof entry !== "object" || entry === null) continue;
    const inner = (entry as { hooks?: unknown }).hooks;
    if (!Array.isArray(inner)) continue;
    const refsHook = inner.some((h) => {
      const cmd = typeof h === "object" && h !== null ? (h as { command?: unknown }).command : undefined;
      if (typeof cmd !== "string") return false;
      return (
        cmd.includes("vinctor-codex-hook") ||
        cmd.endsWith("dist/src/cli.js") ||
        (binPath !== null && cmd.includes(binPath))
      );
    });
    if (!refsHook) continue;
    const matcher = (entry as { matcher?: unknown }).matcher;
    return typeof matcher === "string" ? matcher : "";
  }
  return null;
}

function checkEnv(inp: DoctorInput): DoctorCheck {
  // Presence only — values are NEVER read into the report.
  const missing = REQUIRED_ENV.filter((k) => {
    const v = inp.env[k];
    return v === undefined || v === "";
  });
  if (missing.length === 0) {
    return { name: "vinctor-env", status: "pass", detail: "VINCTOR_ENDPOINT, VINCTOR_AGENT_KEY, VINCTOR_GRANT_REF all set" };
  }
  return {
    name: "vinctor-env",
    status: "warn",
    detail: `missing: ${missing.join(", ")} — the hook fail-closes (denies mapped calls) until these are set`,
  };
}

function checkService(inp: DoctorInput): DoctorCheck {
  if (inp.endpointReachable === null) {
    return { name: "service-reachable", status: "warn", detail: "VINCTOR_ENDPOINT not set — skipped" };
  }
  if (inp.endpointReachable) {
    return { name: "service-reachable", status: "pass", detail: "endpoint answered a request" };
  }
  return {
    name: "service-reachable",
    status: "warn",
    detail: "endpoint is set but did not answer — mapped calls will fail-closed until it is reachable",
  };
}

function checkClassifierSmoke(): DoctorCheck {
  // Prove the classifier maps a known command WITHOUT needing Codex or a service.
  const builtInsOnly: HookConfig = { version: 1, rules: [] };
  try {
    const parsed = parseEvent({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm publish" },
    });
    const mapping = resolve(parsed, builtInsOnly);
    if (mapping.kind === "Mapped") {
      return { name: "classifier-smoke", status: "pass", detail: `npm publish -> ${mapping.action}:${mapping.resource}` };
    }
    return { name: "classifier-smoke", status: "fail", detail: "npm publish did not map (classifier broken)" };
  } catch (e) {
    return { name: "classifier-smoke", status: "fail", detail: `classifier threw: ${(e as Error).message}` };
  }
}

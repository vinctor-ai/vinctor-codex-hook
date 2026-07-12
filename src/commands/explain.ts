import { readFileSync } from "node:fs";
import { collectConfigErrors } from "../config.js";
import { HookError } from "../errors.js";
import { evaluateRule, getInputForRule, resolve, sortBySpecificity } from "../mapping.js";
import { parseEvent } from "../parser.js";
import type { ExplainResult, HookConfig, ParsedEvent, Rule } from "../types.js";

export type RunExplainOpts = {
  eventPath: string;
  configPath: string;
  env: Record<string, string | undefined>;
  readFile?: (path: string) => string;
};

export function runExplain(opts: RunExplainOpts): ExplainResult {
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));

  // 1. Read + parse the event file. A missing/unreadable/non-JSON event file is a
  //    caller mistake — let it throw so the CLI maps it to exit 2.
  const eventRaw = readFile(opts.eventPath);
  let eventJson: unknown;
  try {
    eventJson = JSON.parse(eventRaw);
  } catch (e) {
    throw new Error(`event file is not valid JSON: ${(e as Error).message}`);
  }

  // 2. Resolve + load config. Absent → built-ins only. Present but invalid →
  //    config_error.
  const configPath = resolveConfigPath(opts);
  const configRead = tryReadConfig(readFile, configPath);
  if (configRead.kind === "invalid") {
    return { command: "explain", decision: "config_error", configPath, errors: configRead.errors };
  }
  const config: HookConfig = configRead.config;

  // 3. Parse the event.
  let parsed: ParsedEvent;
  try {
    parsed = parseEvent(eventJson);
  } catch (e) {
    if (e instanceof HookError && (e.code === "malformed_payload" || e.code === "parse_unsafe")) {
      return { command: "explain", decision: "parse_error", errorCode: e.code, message: e.message };
    }
    throw e;
  }

  // 4. Resolve the mapping. matchInput is a representative display of what a rule
  //    would match against (command / op summary / mcp tool name).
  const matchInput = getInputForRule(neutralRule(parsed.tool), parsed) ?? "";
  const mapping = resolve(parsed, config);
  if (mapping.kind === "Unmapped") {
    return { command: "explain", tool: parsed.tool, matchInput, decision: "unmapped", action: null, resource: null, source: null, rule: null };
  }
  return {
    command: "explain",
    tool: parsed.tool,
    matchInput,
    decision: "mapped",
    action: mapping.action,
    resource: mapping.resource,
    source: mapping.source,
    rule: mapping.source === "config" ? findWinningRule(parsed, config) : null,
  };
}

function resolveConfigPath(opts: RunExplainOpts): string {
  const override = opts.env.VINCTOR_CODEX_HOOK_CONFIG;
  if (typeof override === "string" && override.length > 0) return override;
  return opts.configPath;
}

type ConfigRead =
  | { kind: "ok"; config: HookConfig }
  | { kind: "invalid"; errors: ReturnType<typeof collectConfigErrors> };

function tryReadConfig(readFile: (p: string) => string, path: string): ConfigRead {
  // A config file that cannot be read (absent or unreadable) means built-ins
  // only — explain treats a throwing read as "no config".
  let raw: string;
  try {
    raw = readFile(path);
  } catch {
    return { kind: "ok", config: { version: 1, rules: [] } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { kind: "invalid", errors: [{ ruleIndex: null, field: null, message: `config is not valid JSON: ${(e as Error).message}` }] };
  }
  const errors = collectConfigErrors(parsed);
  if (errors.length > 0) return { kind: "invalid", errors };
  return { kind: "ok", config: parsed as HookConfig };
}

// A rule with no inputField, so getInputForRule returns the tool's natural input
// string (command / op summary / mcp tool name) for display.
function neutralRule(tool: string): Rule {
  return { tool: tool as Rule["tool"], matchType: "exact", pattern: "", action: "read", resource: "x" };
}

// Re-run the config layer to recover which rule won (resolve() returns only the
// mapped action/resource, not the rule object). apply_patch matches per-op path;
// Bash/MCP match the single natural input.
function findWinningRule(parsed: ParsedEvent, config: HookConfig): Rule | null {
  let candidates: Rule[];
  if (parsed.tool === "apply_patch") {
    candidates = config.rules.filter(
      (r) => r.tool === "apply_patch" && parsed.ops.some((op) => evaluateRule(r, "apply_patch", op.normalizedPath)),
    );
  } else {
    candidates = config.rules.filter((r) => {
      if (r.tool !== parsed.tool) return false;
      const input = getInputForRule(r, parsed);
      if (input === null) return false;
      return evaluateRule(r, parsed.tool, input);
    });
  }
  if (candidates.length === 0) return null;
  return sortBySpecificity(candidates)[0] ?? null;
}

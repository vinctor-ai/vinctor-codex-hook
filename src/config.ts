import { existsSync, readFileSync } from "node:fs";
import { InvalidConfigError } from "./errors.js";
import { isMcpToolName } from "./mcp-name.js";
import type { Action, ConfigError, HookConfig, MatchType, Rule } from "./types.js";

const VALID_ACTIONS: ReadonlySet<Action> = new Set([
  "read", "write", "execute", "deploy", "delete", "send",
]);
const CODEX_TOOLS: ReadonlySet<string> = new Set([
  "Bash", "apply_patch", "Read", "Write", "Edit", "MultiEdit", "WebFetch", "WebSearch",
]);
const VALID_MATCH_TYPES: ReadonlySet<MatchType> = new Set(["exact", "prefix", "glob"]);

export type LoadConfigOpts = {
  path: string;                   // default path (caller passes ".vinctor/codex-hook.json")
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export function loadConfig(opts: LoadConfigOpts): HookConfig {
  const override = opts.env.VINCTOR_CODEX_HOOK_CONFIG;
  const effectivePath = typeof override === "string" && override.length > 0 ? override : opts.path;

  if (!existsSync(effectivePath)) {
    return { version: 1, rules: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(effectivePath, "utf8");
  } catch (e) {
    throw new InvalidConfigError(`could not read ${effectivePath}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new InvalidConfigError(`config is not valid JSON: ${(e as Error).message}`);
  }
  return validate(parsed);
}

function validate(input: unknown): HookConfig {
  const errors = collectConfigErrors(input);
  if (errors.length > 0) {
    throw new InvalidConfigError(errors[0]!.message);
  }
  // Safe to cast: zero errors means the shape is valid.
  const root = input as { version: 1; rules: unknown[] };
  const rules = root.rules.map((r) => buildRule(r as Record<string, unknown>));
  return { version: 1, rules };
}

export function collectConfigErrors(input: unknown): ConfigError[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [{ ruleIndex: null, field: null, message: "config root must be an object" }];
  }
  const root = input as Record<string, unknown>;
  const errors: ConfigError[] = [];
  if (root.version !== 1) {
    errors.push({ ruleIndex: null, field: "version", message: `unsupported config version: ${String(root.version)} (must be 1)` });
  }
  if (!Array.isArray(root.rules)) {
    errors.push({ ruleIndex: null, field: "rules", message: "config.rules must be an array" });
    return errors; // cannot iterate rules
  }
  for (let i = 0; i < root.rules.length; i++) {
    errors.push(...collectRuleErrors(root.rules[i], i));
  }
  return errors;
}

export function collectRuleErrors(input: unknown, index: number): ConfigError[] {
  const errors: ConfigError[] = [];
  const err = (field: string | null, message: string) =>
    errors.push({ ruleIndex: index, field, message });

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    err(null, `rules[${index}] must be an object`);
    return errors;
  }
  const r = input as Record<string, unknown>;

  if (typeof r.tool !== "string") {
    err("tool", `rules[${index}].tool must be a string`);
  } else if (!CODEX_TOOLS.has(r.tool) && !isMcpToolName(r.tool)) {
    err("tool", `rules[${index}].tool invalid: ${r.tool} (must be Bash, apply_patch, Read, Write, Edit, MultiEdit, WebFetch, WebSearch, or mcp__<server>__<tool>)`);
  }

  if (typeof r.matchType !== "string" || !VALID_MATCH_TYPES.has(r.matchType as MatchType)) {
    err("matchType", `rules[${index}].matchType must be one of exact, prefix, glob`);
  }

  if (typeof r.pattern !== "string" || r.pattern.length === 0) {
    err("pattern", `rules[${index}].pattern must be a non-empty string`);
  }

  if (typeof r.action !== "string" || !VALID_ACTIONS.has(r.action as Action)) {
    err("action", `rules[${index}].action invalid: ${String((r as { action?: unknown }).action)} (must be one of read, write, execute, deploy, delete, send)`);
  }

  if (typeof r.resource !== "string" || r.resource.length === 0) {
    err("resource", `rules[${index}].resource must be a non-empty string`);
  } else if (r.resource.includes("*")) {
    err("resource", `rules[${index}].resource may not contain wildcards`);
  }

  if (r.inputField !== undefined) {
    if (typeof r.inputField !== "string" || r.inputField.length === 0) {
      err("inputField", `rules[${index}].inputField must be a non-empty string`);
    } else if (!/^[A-Za-z0-9_]+$/.test(r.inputField)) {
      err("inputField", `rules[${index}].inputField "${r.inputField}" must match [A-Za-z0-9_]+`);
    }
  }

  return errors;
}

// Build a typed Rule from an already-validated object. Only called after
// collectRuleErrors confirmed the object is valid.
function buildRule(r: Record<string, unknown>): Rule {
  return {
    tool: r.tool as Rule["tool"],
    matchType: r.matchType as MatchType,
    pattern: r.pattern as string,
    inputField: r.inputField as string | undefined,
    action: r.action as Action,
    resource: r.resource as string,
  };
}

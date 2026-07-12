import { collectConfigErrors } from "../config.js";
import type { ConfigError, ValidateResult } from "../types.js";

export type RunValidateOpts = {
  configPath: string;
  // The config file contents, or null if the file is absent. The CLI layer reads
  // the file; runValidate stays pure.
  raw: string | null;
};

export function runValidate(opts: RunValidateOpts): ValidateResult {
  const { configPath, raw } = opts;

  if (raw === null) {
    return {
      command: "validate",
      configPath,
      ok: true,
      ruleCount: 0,
      errors: [],
      note: "no config file; built-in defaults only",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err: ConfigError = { ruleIndex: null, field: null, message: `config is not valid JSON: ${(e as Error).message}` };
    return { command: "validate", configPath, ok: false, ruleCount: 0, errors: [err] };
  }

  const ruleCount = countRules(parsed);
  const errors = collectConfigErrors(parsed);
  return { command: "validate", configPath, ok: errors.length === 0, ruleCount, errors };
}

function countRules(parsed: unknown): number {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const rules = (parsed as { rules?: unknown }).rules;
    if (Array.isArray(rules)) return rules.length;
  }
  return 0;
}

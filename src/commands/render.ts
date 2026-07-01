import type { ExplainResult, ValidateResult } from "../types.js";

// Claude Code tool names the hook classifies but Codex may not emit a PreToolUse
// event for (version-dependent). A MAPPED result for these means "would be checked
// IF Codex fires the hook" — flag that so an operator doesn't over-trust `explain`.
const CODEX_FIRING_UNCERTAIN: ReadonlySet<string> = new Set([
  "Read", "Write", "Edit", "MultiEdit", "WebFetch", "WebSearch",
]);

export function renderValidateText(res: ValidateResult): string {
  if (res.ok) {
    if (res.note) return `✓ ${res.note} (${res.configPath})`;
    return `✓ Valid — ${res.ruleCount} rule${res.ruleCount === 1 ? "" : "s"} (${res.configPath})`;
  }
  const lines = [`✗ Invalid config (${res.configPath}) — ${res.errors.length} error${res.errors.length === 1 ? "" : "s"}:`];
  for (const e of res.errors) {
    lines.push(`  ✗ ${e.message}`);
  }
  return lines.join("\n");
}

export function renderExplainText(res: ExplainResult): string {
  if (res.decision === "parse_error") {
    return `Event could not be parsed: ${res.errorCode}\n  ${res.message}`;
  }
  if (res.decision === "config_error") {
    const lines = [`Config is invalid (${res.configPath}); fix it before explaining:`];
    for (const e of res.errors) lines.push(`  ✗ ${e.message}`);
    return lines.join("\n");
  }
  const lines = [
    `Tool:     ${res.tool}`,
    `Input:    ${res.matchInput}`,
  ];
  if (res.decision === "unmapped") {
    lines.push(`Decision: UNMAPPED → the hook abstains (emits no decision); Codex's native approval flow applies`);
    return lines.join("\n");
  }
  lines.push(`Decision: MAPPED (via ${res.source})`);
  lines.push(`  action:   ${res.action}`);
  lines.push(`  resource: ${res.resource}`);
  if (res.rule) {
    lines.push(`  rule:     ${res.rule.tool} ${res.rule.matchType} "${res.rule.pattern}"${res.rule.inputField ? ` [inputField=${res.rule.inputField}]` : ""}`);
  }
  lines.push(`Would call /v1/enforce with { action: "${res.action}", resource: "${res.resource}" }. (explain does not call the service.)`);
  if (CODEX_FIRING_UNCERTAIN.has(res.tool)) {
    lines.push(`Note: "${res.tool}" is a Claude Code tool name; whether Codex emits a PreToolUse event for it is version-dependent (see README Tool Coverage caveat). MAPPED here means "would be checked if Codex fires the hook".`);
  }
  return lines.join("\n");
}

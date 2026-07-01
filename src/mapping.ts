import micromatch from "micromatch";
import type { Action, Rule, ToolName } from "./types.js";
import { dispatchClassifier, dispatchMcpClassifier } from "./classifiers/index.js";
import { classifySensitivePath } from "./classifiers/sensitive-paths.js";
import { classifyProtectedPath } from "./defaults/protected-paths.js";
import { allDefaultsInOrder } from "./defaults/index.js";
import type {
  ApplyPatchParsed,
  HookConfig,
  MappingResult,
  MCPParsed,
  ParsedEvent,
} from "./types.js";

function isMcpEvent(e: ParsedEvent): e is MCPParsed {
  return e.tool.startsWith("mcp__");
}

export function evaluateRule(rule: Rule, tool: ToolName, input: string): boolean {
  if (rule.tool !== tool) return false;
  switch (rule.matchType) {
    case "exact":
      return input === rule.pattern;
    case "prefix":
      return input === rule.pattern || input.startsWith(rule.pattern + " ");
    case "glob":
      return micromatch.isMatch(input, rule.pattern, { dot: true });
  }
}

const MATCHTYPE_RANK: Record<Rule["matchType"], number> = {
  exact: 0,
  prefix: 1,
  glob: 2,
};

function literalTokenCount(pattern: string): number {
  return pattern.split(/\s+/).filter((tok) => !tok.includes("*")).length;
}

function wildcardCount(pattern: string): number {
  return (pattern.match(/\*/g) ?? []).length;
}

export function sortBySpecificity(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const r = MATCHTYPE_RANK[a.matchType] - MATCHTYPE_RANK[b.matchType];
    if (r !== 0) return r;
    const lt = literalTokenCount(b.pattern) - literalTokenCount(a.pattern);
    if (lt !== 0) return lt;
    const wc = wildcardCount(a.pattern) - wildcardCount(b.pattern);
    if (wc !== 0) return wc;
    return b.pattern.length - a.pattern.length;
  });
}

/**
 * The string a config rule matches against for a given event. Bash → normalized
 * command; file tools → normalized path; WebFetch → host; WebSearch → query;
 * MCP → the `inputField` value (or tool name); apply_patch → a display summary of
 * its ops (matched per-op in resolveApplyPatch, so this is only used by `explain`).
 */
export function getInputForRule(rule: Rule, event: ParsedEvent): string | null {
  switch (event.tool) {
    case "Bash":
      return event.normalizedCommand;
    case "apply_patch":
      return event.ops.map((o) => `${o.action} ${o.normalizedPath}`).join(", ");
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return event.normalizedPath;
    case "WebFetch":
      return event.host;
    case "WebSearch":
      return event.query;
    default: {
      // MCP — `mcp__${string}__${string}` is the only remaining branch.
      if (!rule.inputField) return event.toolName;
      const val = event.toolInput[rule.inputField];
      if (typeof val !== "string") return null;
      if (val.length === 0) return null;
      if (val.includes("\0")) return null;
      return val;
    }
  }
}

/** Most specific rule whose pattern matches the event's natural input, or null. */
function matchRules(rules: Rule[], event: ParsedEvent): Rule | null {
  const candidates = rules.filter((r) => {
    if (r.tool !== event.tool) return false;
    const ruleInput = getInputForRule(r, event);
    if (ruleInput === null) return false;
    return evaluateRule(r, event.tool, ruleInput);
  });
  if (candidates.length === 0) return null;
  return sortBySpecificity(candidates)[0]!;
}

export function resolve(event: ParsedEvent, config: HookConfig): MappingResult {
  if (event.tool === "apply_patch") {
    return resolveApplyPatch(event, config);
  }

  // 1. operator config (single-input engine: Bash / file tools / Web / MCP).
  const configMatch = matchRules(config.rules, event);
  if (configMatch) {
    return { kind: "Mapped", action: configMatch.action, resource: configMatch.resource, source: "config" };
  }

  // 2-MCP. built-in MCP classifier (operator config already had priority above).
  if (isMcpEvent(event)) {
    const cls = dispatchMcpClassifier(event);
    if (cls.kind === "Mapped") {
      return { kind: "Mapped", action: cls.action, resource: cls.resource, source: "classifier" };
    }
    return { kind: "Unmapped" };
  }

  // 2a. WebFetch universal built-in — every fetch maps to a net resource.
  if (event.tool === "WebFetch") {
    return {
      kind: "Mapped",
      action: "send",
      resource: `net/${event.scope}/${event.host}`,
      source: "defaults",
    };
  }

  // 2b. Bash classifier-aware refinement.
  if (event.tool === "Bash") {
    const cls = dispatchClassifier(event.firstToken, event.normalizedCommand);
    if (cls.kind === "Mapped") {
      return { kind: "Mapped", action: cls.action, resource: cls.resource, source: "classifier" };
    }
    if (cls.kind === "RecognizedButUnclassified") {
      return { kind: "Unmapped" };
    }
    // NotApplicable -> fall through to pattern defaults
  }

  // 3. pattern defaults (Bash + file tools).
  const defaultMatch = matchRules(allDefaultsInOrder(), event);
  if (defaultMatch) {
    return { kind: "Mapped", action: defaultMatch.action, resource: defaultMatch.resource, source: "defaults" };
  }

  return { kind: "Unmapped" };
}

// --- apply_patch resolution -------------------------------------------------

const ACTION_RISK: Record<"write" | "delete", number> = { delete: 2, write: 1 };

/**
 * apply_patch touches one or more file paths; the hook makes a single decision.
 * Operator config (matched against any op path) wins; otherwise built-in secret /
 * protected-path classification applies, using each op's own action. When several
 * ops are in-boundary the most destructive (then most specific) wins — one
 * /v1/enforce call per the v1 contract. No op in-boundary → abstain.
 */
export function resolveApplyPatch(event: ApplyPatchParsed, config: HookConfig): MappingResult {
  const configMatches = config.rules.filter(
    (r) => r.tool === "apply_patch" && event.ops.some((op) => evaluateRule(r, "apply_patch", op.normalizedPath)),
  );
  if (configMatches.length > 0) {
    const top = sortBySpecificity(configMatches)[0]!;
    return { kind: "Mapped", action: top.action, resource: top.resource, source: "config" };
  }

  const candidates: { action: "write" | "delete"; resource: string }[] = [];
  for (const op of event.ops) {
    const secret = classifySensitivePath(op.normalizedPath);
    if (secret) {
      candidates.push({ action: op.action, resource: secret });
      continue;
    }
    const protectedRes = classifyProtectedPath(op.normalizedPath);
    if (protectedRes) {
      candidates.push({ action: op.action, resource: protectedRes });
    }
  }
  if (candidates.length === 0) return { kind: "Unmapped" };

  const winner = candidates.sort((a, b) => {
    const r = ACTION_RISK[b.action] - ACTION_RISK[a.action];
    if (r !== 0) return r;
    return b.resource.length - a.resource.length;
  })[0]!;
  return { kind: "Mapped", action: winner.action as Action, resource: winner.resource, source: "defaults" };
}

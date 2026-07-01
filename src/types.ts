import type { DenyCode } from "./errors.js";
export type { DenyCode };

/**
 * Codex CLI PreToolUse hook event. Codex sends a superset of the fields the
 * Claude Code hook does — `model` and `turn_id` are Codex-specific. Only
 * `hook_event_name`, `tool_name`, and `tool_input` drive behavior.
 */
export type PreToolUseEvent = {
  hook_event_name: "PreToolUse";
  session_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  model?: string;
  turn_id?: string;
  permission_mode?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
};

export type Action = "read" | "write" | "execute" | "deploy" | "delete" | "send";

/**
 * Tool surfaces the hook understands. `Bash`, `apply_patch`, and `mcp__*` are the
 * surfaces Codex's PreToolUse currently fires for; `Read`/`Write`/`Edit`/
 * `MultiEdit`/`WebFetch`/`WebSearch` are also supported so the hook can classify
 * them if a runtime (or a future Codex build) emits them. See README for the
 * Codex hook-firing caveat.
 */
export type FileTool = "Read" | "Write" | "Edit" | "MultiEdit";
export type WebTool = "WebFetch" | "WebSearch";
export type CodexNativeTool = "Bash" | "apply_patch";
export type MCPToolName = `mcp__${string}__${string}`;
export type ToolName = CodexNativeTool | FileTool | WebTool | MCPToolName;

export type MatchType = "exact" | "prefix" | "glob";

export type Rule = {
  tool: ToolName;
  matchType: MatchType;
  pattern: string;
  inputField?: string;
  action: Action;
  resource: string;
};

export type HookConfig = { version: 1; rules: Rule[] };

export type BashParsed = {
  tool: "Bash";
  rawCommand: string;
  normalizedCommand: string;
  firstToken: string;
};

/** One file operation extracted from an apply_patch envelope. */
export type ApplyPatchOp = {
  action: "write" | "delete";
  rawPath: string;
  normalizedPath: string;
};

export type ApplyPatchParsed = {
  tool: "apply_patch";
  ops: ApplyPatchOp[];
};

export type FileParsed = {
  tool: FileTool;
  rawPath: string;
  normalizedPath: string;
};

export type WebFetchParsed = {
  tool: "WebFetch";
  rawUrl: string;
  host: string;
  scope: "internal" | "external";
};

export type WebSearchParsed = {
  tool: "WebSearch";
  query: string;
};

export type MCPParsed = {
  tool: MCPToolName;
  toolName: string;
  toolInput: Record<string, unknown>;
};

export type ParsedEvent =
  | BashParsed
  | ApplyPatchParsed
  | FileParsed
  | WebFetchParsed
  | WebSearchParsed
  | MCPParsed;

export type Mapped = {
  kind: "Mapped";
  action: Action;
  resource: string;
  source: "config" | "classifier" | "defaults";
};
export type Unmapped = { kind: "Unmapped" };
export type MappingResult = Mapped | Unmapped;

export type ClassifierResult =
  | { kind: "Mapped"; action: Action; resource: string }
  | { kind: "RecognizedButUnclassified" }
  | { kind: "NotApplicable" };

/**
 * Codex honors only `allow` and `deny`. `ask` is parsed-but-unsupported, so the
 * hook never emits it — an unmapped call abstains (empty stdout) instead.
 */
export type Decision = "allow" | "deny";

export type HookOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: Decision;
    permissionDecisionReason?: string;
  };
};

/**
 * What the CLI should write. `decision` → serialize the JSON envelope; `abstain`
 * → write nothing and exit 0 (defers to Codex's native approval flow).
 */
export type HookResponse =
  | { emit: "decision"; output: HookOutput }
  | { emit: "abstain" };

// --- validate / explain subcommand result types ---

export type ConfigError = {
  ruleIndex: number | null; // null for top-level errors (version, rules array, JSON parse)
  field: string | null;     // e.g. "action", "inputField"; null for top-level
  message: string;
};

export type ValidateResult = {
  command: "validate";
  configPath: string;
  ok: boolean;
  ruleCount: number;
  errors: ConfigError[];
  note?: string;
};

export type ExplainRule = {
  tool: string;
  matchType: MatchType;
  pattern: string;
  inputField?: string;
  action: Action;
  resource: string;
};

export type ExplainResult =
  | {
      command: "explain";
      tool: string;
      matchInput: string;
      decision: "mapped";
      action: Action;
      resource: string;
      source: "config" | "classifier" | "defaults";
      rule: ExplainRule | null;
    }
  | {
      command: "explain";
      tool: string;
      matchInput: string;
      decision: "unmapped";
      action: null;
      resource: null;
      source: null;
      rule: null;
    }
  | {
      command: "explain";
      decision: "parse_error";
      errorCode: "malformed_payload" | "parse_unsafe";
      message: string;
    }
  | {
      command: "explain";
      decision: "config_error";
      configPath: string;
      errors: ConfigError[];
    };

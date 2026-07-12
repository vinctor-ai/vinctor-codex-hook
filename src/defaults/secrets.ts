import type { FileTool, Rule } from "../types.js";

// Sensitive file patterns, shared between read-side and write-side rules so the
// two directions stay in sync. Each entry maps a glob to a secret/<kind> resource.
const SENSITIVE_FILE_PATTERNS: ReadonlyArray<{ pattern: string; resource: string }> = [
  { pattern: "**/.env",                              resource: "secret/env" },
  { pattern: "**/.env.*",                            resource: "secret/env" },
  { pattern: "**/.ssh/id_*",                         resource: "secret/ssh" },
  { pattern: "**/.ssh/*.pem",                        resource: "secret/ssh" },
  { pattern: "**/.aws/credentials",                  resource: "secret/aws" },
  { pattern: "**/.config/gcloud/**/credentials*",    resource: "secret/gcp" },
];

const WRITE_TOOLS: ReadonlyArray<FileTool> = ["Write", "Edit", "MultiEdit"];

function fileRule(tool: FileTool, action: "read" | "write", entry: { pattern: string; resource: string }): Rule {
  return { tool, matchType: "glob", pattern: entry.pattern, action, resource: entry.resource };
}

export const secretsRules: Rule[] = [
  // Read access to sensitive files.
  ...SENSITIVE_FILE_PATTERNS.map((entry) => fileRule("Read", "read", entry)),
  // Write/Edit/MultiEdit of the same sensitive files — credential writes must be
  // inside the authorization boundary, symmetric with the read-side rules above.
  ...WRITE_TOOLS.flatMap((tool) =>
    SENSITIVE_FILE_PATTERNS.map((entry) => fileRule(tool, "write", entry)),
  ),
  // Bash equivalents (read). (apply_patch credential writes are covered by the
  // shared secret-path classification in mapping.resolveApplyPatch.)
  { tool: "Bash", matchType: "prefix", pattern: "cat .env",     action: "read", resource: "secret/env" },
  { tool: "Bash", matchType: "prefix", pattern: "cat ./.env",   action: "read", resource: "secret/env" },
  { tool: "Bash", matchType: "prefix", pattern: "printenv",     action: "read", resource: "secret/env" },
];

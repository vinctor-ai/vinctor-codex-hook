import type { FileTool, Rule } from "../types.js";

const WRITE_TOOLS: FileTool[] = ["Write", "Edit", "MultiEdit"];

function writeRule(pattern: string, resource: string): Rule[] {
  return WRITE_TOOLS.map<Rule>((tool) => ({
    tool, matchType: "glob", pattern, action: "write", resource,
  }));
}

export const protectedFilesRules: Rule[] = [
  ...writeRule("**/.github/workflows/*.yml",  "ci/workflow"),
  ...writeRule("**/.github/workflows/*.yaml", "ci/workflow"),
  ...writeRule("**/package.json",             "repo/manifest/npm"),
  ...writeRule("**/Dockerfile",               "infra/dockerfile"),
  ...writeRule("**/Dockerfile.*",             "infra/dockerfile"),
  ...writeRule("**/*.tf",                     "infra/terraform"),
  ...writeRule("**/k8s/**/*.yml",             "infra/k8s"),
  ...writeRule("**/k8s/**/*.yaml",            "infra/k8s"),
];

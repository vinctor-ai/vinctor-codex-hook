import type { Rule } from "../types.js";

export const releasePublishRules: Rule[] = [
  { tool: "Bash", matchType: "prefix", pattern: "npm publish",   action: "deploy", resource: "npm/package" },
  { tool: "Bash", matchType: "prefix", pattern: "pnpm publish",  action: "deploy", resource: "npm/package" },
  { tool: "Bash", matchType: "prefix", pattern: "yarn publish",  action: "deploy", resource: "npm/package" },
  { tool: "Bash", matchType: "prefix", pattern: "docker push",   action: "deploy", resource: "docker/image" },
  { tool: "Bash", matchType: "prefix", pattern: "gh release create", action: "deploy", resource: "gh/release" },
  { tool: "Bash", matchType: "prefix", pattern: "cargo publish", action: "deploy", resource: "cargo/crate" },
];

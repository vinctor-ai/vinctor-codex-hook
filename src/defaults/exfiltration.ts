import type { Rule } from "../types.js";

// SKELETAL per spec §7.1.
export const exfiltrationRules: Rule[] = [
  { tool: "Bash", matchType: "prefix", pattern: "scp",            action: "send",  resource: "net/scp" },
  { tool: "Bash", matchType: "prefix", pattern: "gh secret set",  action: "write", resource: "secret/gh" },
];

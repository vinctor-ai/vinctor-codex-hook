import type { Rule } from "../types.js";

// SKELETAL per spec §7.1. Operators should add environment-specific
// infra rules. These representative patterns demonstrate the category.
export const infraOpsRules: Rule[] = [
  { tool: "Bash", matchType: "prefix", pattern: "kubectl apply",  action: "execute", resource: "infra/k8s/apply" },
  { tool: "Bash", matchType: "prefix", pattern: "terraform apply", action: "execute", resource: "infra/terraform/apply" },
];

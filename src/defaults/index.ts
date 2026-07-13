import type { Rule } from "../types.js";
import { secretsRules } from "./secrets.js";
import { protectedFilesRules } from "./protected-files.js";
import { releasePublishRules } from "./release-publish.js";
import { infraOpsRules } from "./infra-ops.js";
import { exfiltrationRules } from "./exfiltration.js";

// All built-in pattern defaults (Bash + file tools), in match-precedence order.
// (apply_patch is classified separately in mapping.resolveApplyPatch via the
// shared secret-path module and protected-paths.)
export function allDefaultsInOrder(): Rule[] {
  return [
    ...secretsRules,
    ...protectedFilesRules,
    ...releasePublishRules,
    ...infraOpsRules,
    ...exfiltrationRules,
  ];
}

import type { ClassifierResult } from "../types.js";
import { normalizePathToken, classifySensitivePath } from "./sensitive-paths.js";

export const rmFamilies = ["rm", "rmdir"] as const;

const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };

/**
 * Canon: rm/rmdir → delete:fs/<path>. Only single-target invocations map — a
 * multi-target or glob deletion has no single (action, resource), so the
 * classifier abstains (multi-target handling is adapter policy per the canon's
 * v1 boundaries). Sensitive targets classify over secret/<kind> via the shared
 * sensitive-path overlay, symmetric with the file-tool and apply_patch paths.
 */
export function rmClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  const head = tokens[0];
  if (!head || !(rmFamilies as readonly string[]).includes(head)) {
    return { kind: "NotApplicable" };
  }
  const paths = tokens.slice(1).filter((t) => t !== "--" && !t.startsWith("-"));
  if (paths.length !== 1) return RBU;
  const raw = paths[0]!;
  if (raw.includes("*") || raw.includes("?")) return RBU; // shell glob — not one resource
  const norm = normalizePathToken(raw);
  if (!norm) return RBU; // e.g. `rm /` normalizes to an empty resource path
  const secret = classifySensitivePath(norm);
  return { kind: "Mapped", action: "delete", resource: secret ?? `fs/${norm}` };
}

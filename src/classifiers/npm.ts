import type { ClassifierResult } from "../types.js";

export const npmFamilies = ["npm", "pnpm", "yarn"] as const;

export function npmClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  const head = tokens[0];
  if (!head || !(npmFamilies as readonly string[]).includes(head)) {
    return { kind: "NotApplicable" };
  }
  const sub = tokens[1];
  if (sub === "publish") {
    return { kind: "Mapped", action: "deploy", resource: "npm/package" };
  }
  return { kind: "NotApplicable" };
}

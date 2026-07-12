import type { ClassifierResult } from "../types.js";

export const ghFamily = "gh" as const;

export function ghClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  if (tokens[0] !== "gh") return { kind: "NotApplicable" };
  const a = tokens[1];
  const b = tokens[2];
  if (a === "release" && b === "create") return { kind: "Mapped", action: "deploy", resource: "gh/release" };
  if (a === "secret" && b === "set") return { kind: "Mapped", action: "write", resource: "secret/gh" };
  return { kind: "NotApplicable" };
}

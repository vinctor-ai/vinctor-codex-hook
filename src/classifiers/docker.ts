import type { ClassifierResult } from "../types.js";

export const dockerFamily = "docker" as const;

export function dockerClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  if (tokens[0] !== "docker") return { kind: "NotApplicable" };
  const sub = tokens[1];
  if (sub === "push") return { kind: "Mapped", action: "deploy", resource: "docker/image" };
  if (sub === "rmi" && tokens.includes("-f")) {
    return { kind: "Mapped", action: "delete", resource: "docker/image-force" };
  }
  return { kind: "NotApplicable" };
}

import type { ClassifierResult } from "../types.js";

export const gitFamily = "git" as const;

const READ_ONLY = new Set(["status", "log", "show", "diff", "fetch", "blame", "describe", "rev-parse"]);

export function gitClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  if (tokens[0] !== "git") return { kind: "NotApplicable" };
  const sub = tokens[1] ?? "";
  if (READ_ONLY.has(sub)) return { kind: "NotApplicable" };

  if (sub === "push") {
    const rest = tokens.slice(2);
    if (rest.some((t) => t === "--force" || t === "-f" || t === "--force-with-lease")) {
      return { kind: "Mapped", action: "execute", resource: "git/push-force" };
    }
    // Recognized as git push but the rest of the flags aren't in our known-safe set.
    const known = new Set(["origin", "main", "master", "HEAD", "-u", "--set-upstream", "--tags"]);
    const allKnown = rest.every((t) => known.has(t) || /^[a-zA-Z0-9_\/.][a-zA-Z0-9_\/\.-]*$/.test(t));
    if (allKnown) {
      return { kind: "Mapped", action: "execute", resource: "git/push" };
    }
    return { kind: "RecognizedButUnclassified" };
  }
  if (sub === "reset" && tokens.includes("--hard")) {
    return { kind: "Mapped", action: "delete", resource: "git/reset-hard" };
  }
  if (sub === "branch" && tokens.includes("-D")) {
    return { kind: "Mapped", action: "delete", resource: "git/branch-delete-force" };
  }
  if (sub === "clean" && tokens.some((t) => t === "-f" || t === "-fd" || t === "-df")) {
    return { kind: "Mapped", action: "delete", resource: "git/clean-force" };
  }
  // Other git subcommands we don't have a specific classifier for: NotApplicable so defaults can match.
  return { kind: "NotApplicable" };
}

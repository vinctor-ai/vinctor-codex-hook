import type { ClassifierResult } from "../types.js";

export const ghFamily = "gh" as const;

// A single owner/repo path segment: no separators, never a dot-segment
// (the PDP rejects `.`/`..` resource segments; never construct them here).
function saneSegment(s: string | undefined): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_.-]+$/.test(s) && s !== "." && s !== "..";
}

/**
 * owner/repo from a `--repo`/`-R` flag value (`OWNER/REPO` or
 * `HOST/OWNER/REPO`), or null when the flag is absent or malformed. Without
 * the flag, gh infers the repo from the cwd's git remote — not resolvable
 * from command text.
 */
function repoFlagValue(tokens: string[]): { owner: string; repo: string } | null {
  let spec: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--repo" || t === "-R") spec = tokens[i + 1];
    else if (t.startsWith("--repo=")) spec = t.slice("--repo=".length);
    else continue;
    break;
  }
  if (spec === undefined) return null;
  const parts = spec.split("/");
  if (parts.length === 3 && parts[0]!.includes(".")) parts.shift(); // HOST/OWNER/REPO
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!saneSegment(owner) || !saneSegment(repo)) return null;
  return { owner, repo };
}

export function ghClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  if (tokens[0] !== "gh") return { kind: "NotApplicable" };
  const a = tokens[1];
  const b = tokens[2];
  const repo = repoFlagValue(tokens.slice(3));

  // Canon: same logical effect via CLI or API, classified identically — when
  // the target repo is identifiable (--repo/-R). Otherwise legacy coarse
  // resources are preserved so existing coverage does not regress.
  if (a === "pr" && b === "merge") {
    if (repo) return { kind: "Mapped", action: "deploy", resource: `github/${repo.owner}/${repo.repo}/pr` };
    return { kind: "NotApplicable" };
  }
  if (a === "release" && b === "create") {
    if (repo) return { kind: "Mapped", action: "deploy", resource: `github/${repo.owner}/${repo.repo}/release` };
    return { kind: "Mapped", action: "deploy", resource: "gh/release" };
  }
  if (a === "secret" && b === "set") {
    if (repo) return { kind: "Mapped", action: "write", resource: `github/${repo.owner}/${repo.repo}/secret` };
    return { kind: "Mapped", action: "write", resource: "secret/gh" };
  }
  return { kind: "NotApplicable" };
}

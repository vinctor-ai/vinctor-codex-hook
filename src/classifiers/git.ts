import type { ClassifierResult } from "../types.js";

export const gitFamily = "git" as const;

// Canon (vinctor-conformance shell family): local git operations classify over
// the opaque shell resource `shell/git`; only `git push` resolves to the GitHub
// contents resource when the remote is an explicit github.com URL.
const READ_ONLY = new Set(["status", "log", "show", "diff", "fetch", "blame", "describe", "rev-parse"]);
const WRITE_LOCAL = new Set(["add", "commit", "stash", "pull", "clone"]);

// A single owner/repo path segment: no separators, and never a dot-segment
// (the PDP rejects `.`/`..` resource segments; never construct them here).
function saneSegment(s: string | undefined): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_.-]+$/.test(s) && s !== "." && s !== "..";
}

/** owner/repo when a token is an explicit github.com remote URL, else null. */
function githubRemote(token: string): { owner: string; repo: string } | null {
  const m =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(token) ??
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(token) ??
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(token);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!saneSegment(owner) || !saneSegment(repo)) return null;
  return { owner, repo };
}

export function gitClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  if (tokens[0] !== "git") return { kind: "NotApplicable" };
  const sub = tokens[1] ?? "";
  if (READ_ONLY.has(sub)) return { kind: "Mapped", action: "read", resource: "shell/git" };
  if (WRITE_LOCAL.has(sub)) return { kind: "Mapped", action: "write", resource: "shell/git" };

  if (sub === "push") {
    const rest = tokens.slice(2);
    const force = rest.some((t) => t === "--force" || t === "-f" || t === "--force-with-lease");
    // A push uploads commits (write); a force push destroys the remote ref's
    // previous history (delete by canon precedence).
    for (const t of rest) {
      const remote = githubRemote(t);
      if (remote) {
        return {
          kind: "Mapped",
          action: force ? "delete" : "write",
          resource: `github/${remote.owner}/${remote.repo}/contents`,
        };
      }
    }
    if (force) {
      // Named remote: destination owner/repo are not resolvable from command text.
      return { kind: "Mapped", action: "delete", resource: "git/push-force" };
    }
    // Recognized as git push but the rest of the flags aren't in our known-safe set.
    const known = new Set(["origin", "main", "master", "HEAD", "-u", "--set-upstream", "--tags"]);
    const allKnown = rest.every((t) => known.has(t) || /^[a-zA-Z0-9_\/.][a-zA-Z0-9_\/\.-]*$/.test(t));
    if (allKnown) {
      return { kind: "Mapped", action: "write", resource: "git/push" };
    }
    return { kind: "RecognizedButUnclassified" };
  }
  if (sub === "reset" && tokens.includes("--hard")) {
    return { kind: "Mapped", action: "delete", resource: "shell/git" };
  }
  if (sub === "branch" && tokens.includes("-D")) {
    return { kind: "Mapped", action: "delete", resource: "shell/git" };
  }
  if (sub === "clean" && tokens.some((t) => t === "-f" || t === "-fd" || t === "-df")) {
    return { kind: "Mapped", action: "delete", resource: "shell/git" };
  }
  // Other git subcommands we don't have a specific classifier for: NotApplicable so defaults can match.
  return { kind: "NotApplicable" };
}

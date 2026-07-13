import type { ClassifierResult } from "../types.js";

export const dockerFamily = "docker" as const;

const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };

// docker run flags that take no value — safe to skip when locating the image
// ref. Any other flag may consume the next token, so we refuse to guess.
const RUN_NO_VALUE_FLAGS = new Set([
  "--rm", "-d", "--detach", "-i", "--interactive", "-t", "--tty",
  "-it", "-ti", "-dit", "-idt", "--init", "--privileged",
]);

/**
 * Parse a docker image reference into canon (registry, image) form.
 * The first component is a registry iff it looks like a host (contains "." or
 * ":", or is "localhost"); otherwise the registry is the implicit docker.io.
 * Tags and digests are stripped — the canon resource is registry + image.
 */
function parseImageRef(raw: string): { registry: string; image: string } | null {
  let ref = raw;
  const at = ref.indexOf("@");
  if (at !== -1) ref = ref.slice(0, at);
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon > lastSlash) ref = ref.slice(0, lastColon);
  if (ref === "") return null;

  const parts = ref.split("/");
  let registry = "docker.io";
  const first = parts[0]!;
  if (parts.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost")) {
    registry = parts.shift()!;
  }
  if (parts.length === 0) return null;
  // Never construct empty or dot-segment resource parts (PDP traversal defense).
  if (registry === "." || registry === "..") return null;
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return { registry, image: parts.join("/") };
}

function refToResource(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const parsed = parseImageRef(raw);
  if (!parsed) return null;
  return `container/${parsed.registry}/${parsed.image}`;
}

/** First non-flag token, or null if a flag appears that we cannot skip safely. */
function firstRefToken(tokens: string[], skippable: (flag: string) => boolean): string | null {
  for (const t of tokens) {
    if (t.startsWith("-")) {
      if (skippable(t)) continue;
      return null;
    }
    return t;
  }
  return null;
}

export function dockerClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  if (tokens[0] !== "docker") return { kind: "NotApplicable" };
  const sub = tokens[1];
  const rest = tokens.slice(2);

  if (sub === "push" || sub === "rmi") {
    // Any flags on push/rmi take no value in common use (-f, --all-tags, -q).
    const ref = firstRefToken(rest, () => true);
    const resource = ref === null ? null : refToResource(ref);
    if (resource === null) return RBU;
    // push publishes to a registry (deploy); rmi removes the image (delete).
    return { kind: "Mapped", action: sub === "push" ? "deploy" : "delete", resource };
  }

  if (sub === "build") {
    // Build steps (RUN) execute arbitrary commands; the image is named by -t/--tag.
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i]!;
      let value: string | undefined;
      if (t === "-t" || t === "--tag") value = rest[i + 1];
      else if (t.startsWith("--tag=")) value = t.slice("--tag=".length);
      else continue;
      const resource = refToResource(value);
      return resource === null ? RBU : { kind: "Mapped", action: "execute", resource };
    }
    return RBU; // recognized docker build, but no identifiable image target
  }

  if (sub === "run") {
    const ref = firstRefToken(rest, (f) => RUN_NO_VALUE_FLAGS.has(f));
    const resource = ref === null ? null : refToResource(ref);
    if (resource === null) return RBU; // unknown flag may swallow the next token — never guess
    return { kind: "Mapped", action: "execute", resource };
  }

  // Other docker subcommands: NotApplicable so defaults can match.
  return { kind: "NotApplicable" };
}

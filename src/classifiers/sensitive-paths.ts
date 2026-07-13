import micromatch from "micromatch";
import { homedir } from "node:os";

const SENSITIVE_PATTERNS: Array<{ patterns: string[]; resource: string }> = [
  { patterns: ["**/.ssh/id_*", "**/.ssh/*.pem", "**/*.pem"], resource: "secret/ssh" },
  { patterns: ["**/.aws/credentials"], resource: "secret/aws" },
  { patterns: ["**/.config/gcloud/**/credentials*"], resource: "secret/gcp" },
  { patterns: [".env", "**/.env", ".env.*", "**/.env.*"], resource: "secret/env" },
];

// Normalize a path token for glob matching: strip a leading "./", expand a leading
// "~/", and strip a leading "/". No ".." resolution — the resource faithfully
// reflects the requested path; the authorization service makes the final call.
export function normalizePathToken(token: string): string {
  if (token.startsWith("./")) token = token.slice(2);
  if (token.startsWith("~/")) {
    token = homedir().replace(/^\/+/, "") + "/" + token.slice(2);
  }
  token = token.replace(/^\/+/, "");
  return token;
}

// Returns "secret/<kind>" if the normalized path matches a sensitive pattern, else null.
export function classifySensitivePath(normalizedPath: string): string | null {
  for (const { patterns, resource } of SENSITIVE_PATTERNS) {
    if (micromatch.isMatch(normalizedPath, patterns, { dot: true })) return resource;
  }
  return null;
}

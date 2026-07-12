import micromatch from "micromatch";

// Protected (non-secret) file paths whose edits are in-boundary. Used by the
// apply_patch path classifier; the action (write/delete) comes from the patch op,
// so only the path→resource mapping lives here.
const PROTECTED_PATTERNS: ReadonlyArray<{ patterns: string[]; resource: string }> = [
  { patterns: ["**/.github/workflows/*.yml", "**/.github/workflows/*.yaml"], resource: "ci/workflow" },
  { patterns: ["**/package.json"], resource: "repo/manifest/npm" },
  { patterns: ["**/Dockerfile", "**/Dockerfile.*"], resource: "infra/dockerfile" },
  { patterns: ["**/*.tf"], resource: "infra/terraform" },
  { patterns: ["**/k8s/**/*.yml", "**/k8s/**/*.yaml"], resource: "infra/k8s" },
];

/** Returns the protected resource for a normalized path, or null. */
export function classifyProtectedPath(normalizedPath: string): string | null {
  for (const { patterns, resource } of PROTECTED_PATTERNS) {
    if (micromatch.isMatch(normalizedPath, patterns, { dot: true })) return resource;
  }
  return null;
}

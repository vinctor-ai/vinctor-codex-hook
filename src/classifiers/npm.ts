import type { ClassifierResult } from "../types.js";

// npx included: it fetches and runs an arbitrary package binary (canon: npx →
// execute:shell/npx). The classifier branches on the first token itself.
export const npmFamilies = ["npm", "pnpm", "yarn", "npx"] as const;

// Canon shell-family subcommands that run arbitrary project/lifecycle scripts.
const EXECUTE_SUBCOMMANDS = new Set(["test", "run", "install", "ci"]);

// npm package name shapes (bare or scoped). First char alphanumeric, so a
// dot-segment can never form a resource part.
const BARE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
const SCOPED_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

/**
 * The published package name when `npm publish -w/--workspace <name>` names
 * exactly one workspace by package name. Workspace values can also be paths
 * and the flag can repeat — anything but a single name-shaped value returns
 * null and the caller falls back to the unknown-segment resource.
 */
function workspaceName(tokens: string[]): string | null {
  const values: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "-w" || t === "--workspace") {
      const v = tokens[i + 1];
      if (v !== undefined) values.push(v);
    } else if (t.startsWith("--workspace=")) {
      values.push(t.slice("--workspace=".length));
    }
  }
  if (values.length !== 1) return null;
  const v = values[0]!;
  return BARE_NAME.test(v) || SCOPED_NAME.test(v) ? v : null;
}

export function npmClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  const head = tokens[0];
  if (!head || !(npmFamilies as readonly string[]).includes(head)) {
    return { kind: "NotApplicable" };
  }
  if (head === "npx") {
    return { kind: "Mapped", action: "execute", resource: "shell/npx" };
  }
  const sub = tokens[1];
  if (sub === "publish") {
    // Ships to the npm registry (deploy). The name is only in the command
    // text for the workspace spelling (npm publish -w <name>); the bare
    // spelling publishes the cwd package whose name lives in package.json,
    // so it maps to the registry-scoped unknown-segment form.
    const name = head === "npm" ? workspaceName(tokens.slice(2)) : null;
    return { kind: "Mapped", action: "deploy", resource: `pkg/npm/${name ?? "_"}` };
  }
  if (sub !== undefined && EXECUTE_SUBCOMMANDS.has(sub)) {
    return { kind: "Mapped", action: "execute", resource: `shell/${head}` };
  }
  return { kind: "NotApplicable" };
}

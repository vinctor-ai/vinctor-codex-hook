import type { ClassifierResult } from "../types.js";

// Shell interpreters whose stdin is executed as a program.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

const basename = (t: string): string => t.slice(t.lastIndexOf("/") + 1);

/**
 * Canon pipe_to_shell: piped execution of streamed content
 * (e.g. `curl … | sh`) → execute:shell/<first-token>. The resource is the
 * opaque first token — obfuscated commands are the authorization service's
 * job, not the taxonomy's. Runs before first-token family dispatch: whatever
 * the producer is, the pipeline's effect set includes arbitrary execution,
 * and execute is the highest-precedence verb present.
 */
export function pipeToShellClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i] !== "|" && tokens[i] !== "|&") continue;
    let j = i + 1;
    if (tokens[j] === "sudo" || tokens[j] === "env") j += 1;
    const target = tokens[j];
    if (target === undefined || !SHELLS.has(basename(target))) continue;
    const first = basename(tokens[0]!);
    if (first === "" || first === "." || first === "..") return { kind: "RecognizedButUnclassified" };
    return { kind: "Mapped", action: "execute", resource: `shell/${first}` };
  }
  return { kind: "NotApplicable" };
}

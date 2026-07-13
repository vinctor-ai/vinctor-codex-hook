import type { ClassifierResult } from "../types.js";
import { normalizePathToken, classifySensitivePath } from "./sensitive-paths.js";

/**
 * Reader commands whose arguments we scan for sensitive paths.
 * Pipes count: `cat .env | grep X` still maps because .env appears as a token.
 */
const READER_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "nl", "tac", "rev",
  "xxd", "od", "strings", "base64", "hexdump", "cut", "sort",
  "uniq", "wc", "grep", "egrep", "fgrep", "awk", "sed",
]);

/**
 * Secret reader classifier.
 *
 * IMPORTANT: returns NotApplicable (never RecognizedButUnclassified) when no
 * sensitive path is found — so resolve() falls through to existing defaults.
 */
export function secretReaderClassifier(normalizedCommand: string): ClassifierResult {
  const tokens = normalizedCommand.split(" ");
  const head = tokens[0];
  if (!head || !READER_COMMANDS.has(head)) {
    return { kind: "NotApplicable" };
  }
  for (const token of tokens) {
    if (token === "|" || token === ">" || token === ">>" || token === "<") continue;
    if (token.startsWith("-")) continue;
    if (READER_COMMANDS.has(token)) continue;
    const normalized = normalizePathToken(token);
    if (!normalized) continue;
    const resource = classifySensitivePath(normalized);
    if (resource !== null) {
      return { kind: "Mapped", action: "read", resource };
    }
  }
  return { kind: "NotApplicable" };
}

export const secretReaderFamilies = Array.from(READER_COMMANDS);

import { normalizePathToken } from "./classifiers/sensitive-paths.js";
import type { ApplyPatchOp } from "./types.js";

/**
 * Extract file operations from a Codex apply_patch envelope.
 *
 * The envelope is plain text bracketed by `*** Begin Patch` / `*** End Patch`,
 * with one or more file ops:
 *   *** Add File: <path>        → write
 *   *** Update File: <path>     → write   (an optional following
 *   *** Move to: <newpath>        retargets the update's destination)
 *   *** Delete File: <path>     → delete
 *
 * We only need the affected paths and the implied action — not the hunk
 * contents. Lines that aren't op headers are ignored. A patch with no
 * recognizable op header yields an empty array (the caller then abstains rather
 * than guessing).
 */
export function parseApplyPatchOps(patchText: string): ApplyPatchOp[] {
  const ops: ApplyPatchOp[] = [];
  for (const line of patchText.split("\n")) {
    const m = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line.replace(/\r$/, ""));
    if (!m) continue;
    const kind = m[1]!;
    const rawPath = m[2]!.trim();
    if (rawPath.length === 0) continue;

    if (kind === "Move to") {
      // Retarget the most recent write op (the destination of an Update rename).
      const last = ops[ops.length - 1];
      if (last && last.action === "write") {
        last.rawPath = rawPath;
        last.normalizedPath = normalizePathToken(rawPath);
      }
      continue;
    }

    const action = kind === "Delete File" ? "delete" : "write";
    ops.push({ action, rawPath, normalizedPath: normalizePathToken(rawPath) });
  }
  return ops;
}

/**
 * The patch text from an apply_patch tool_input. Codex's freeform apply_patch
 * tool carries the envelope under `input`; some shapes use `patch`. Returns the
 * first non-empty string found, else null.
 */
export function patchTextFromInput(input: Record<string, unknown>): string | null {
  for (const key of ["input", "patch"]) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

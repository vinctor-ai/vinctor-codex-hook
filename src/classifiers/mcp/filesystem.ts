import type { Action, ClassifierResult } from "../../types.js";
import { normalizePathToken, classifySensitivePath } from "../sensitive-paths.js";

const TOOL_ACTIONS: Record<string, Action> = {
  read_text_file: "read",
  read_file: "read", // deprecated alias of read_text_file
  read_media_file: "read",
  read_multiple_files: "read",
  list_directory: "read",
  list_directory_with_sizes: "read",
  directory_tree: "read",
  search_files: "read",
  get_file_info: "read",
  list_allowed_directories: "read",
  write_file: "write",
  edit_file: "write",
  create_directory: "write",
  move_file: "write",
  delete_file: "delete", // fork-compat (canonical server has no delete)
  delete_directory: "delete",
  remove_directory: "delete", // spec-canonical name; delete_directory is the fork alias
};

const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };

function validPath(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !v.includes("\0");
}

// Map one path to a resource: secret/<kind> if sensitive, else fs/<normalized>.
function resourceForPath(action: Action, rawPath: string): ClassifierResult {
  const norm = normalizePathToken(rawPath);
  if (!norm) return RBU;
  const secret = classifySensitivePath(norm);
  return { kind: "Mapped", action, resource: secret ?? `fs/${norm}` };
}

export function filesystemClassifier(tool: string, input: Record<string, unknown>): ClassifierResult {
  const action = TOOL_ACTIONS[tool];
  if (!action) return RBU; // recognized server, unknown tool — defer to user

  if (tool === "list_allowed_directories") {
    return { kind: "Mapped", action: "read", resource: "fs/_allowed-dirs" };
  }

  if (tool === "move_file") {
    const { source, destination } = input;
    if (!validPath(source) || !validPath(destination)) return RBU;
    const sNorm = normalizePathToken(source);
    const dNorm = normalizePathToken(destination);
    const sSecret = sNorm ? classifySensitivePath(sNorm) : null;
    if (sSecret) return { kind: "Mapped", action: "write", resource: sSecret };
    const dSecret = dNorm ? classifySensitivePath(dNorm) : null;
    if (dSecret) return { kind: "Mapped", action: "write", resource: dSecret };
    if (!dNorm) return RBU;
    return { kind: "Mapped", action: "write", resource: `fs/${dNorm}` };
  }

  if (tool === "read_multiple_files") {
    const { paths } = input;
    if (!Array.isArray(paths) || paths.length === 0) return RBU;
    for (const p of paths) {
      if (!validPath(p)) return RBU;
      const norm = normalizePathToken(p);
      const secret = norm ? classifySensitivePath(norm) : null;
      if (secret) return { kind: "Mapped", action: "read", resource: secret };
    }
    return RBU; // multiple non-sensitive paths cannot be one (action, resource)
  }

  // single-path tools
  if (!validPath(input.path)) return RBU;
  return resourceForPath(action, input.path);
}

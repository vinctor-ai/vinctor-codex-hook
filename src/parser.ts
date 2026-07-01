import { homedir } from "node:os";
import { resolve as pathResolve } from "node:path";
import { parseApplyPatchOps, patchTextFromInput } from "./apply-patch.js";
import { MalformedPayloadError, ParseUnsafeError } from "./errors.js";
import { isMcpToolName } from "./mcp-name.js";
import type { FileTool, ParsedEvent, PreToolUseEvent } from "./types.js";
import { parseAndClassifyUrl } from "./url.js";

const SUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "apply_patch",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "WebFetch",
  "WebSearch",
]);

export function parseEvent(input: unknown): ParsedEvent {
  if (!isObject(input)) {
    throw new MalformedPayloadError("event is not an object");
  }
  const ev = input as Partial<PreToolUseEvent>;
  if (ev.hook_event_name !== "PreToolUse") {
    throw new MalformedPayloadError("missing or invalid hook_event_name");
  }
  if (typeof ev.tool_name !== "string") {
    throw new MalformedPayloadError(`unsupported tool_name: ${String(ev.tool_name)}`);
  }
  const isMcp = isMcpToolName(ev.tool_name);
  if (!SUPPORTED_TOOLS.has(ev.tool_name) && !isMcp) {
    throw new MalformedPayloadError(`unsupported tool_name: ${ev.tool_name}`);
  }
  if (!isObject(ev.tool_input)) {
    throw new MalformedPayloadError("missing or invalid tool_input");
  }
  const tool = ev.tool_name;

  if (tool === "Bash") {
    return parseBash(ev.tool_input);
  }
  if (tool === "apply_patch") {
    return parseApplyPatch(ev.tool_input);
  }
  if (tool === "WebFetch") {
    return parseWebFetch(ev.tool_input);
  }
  if (tool === "WebSearch") {
    return parseWebSearch(ev.tool_input);
  }
  if (isMcp) {
    return parseMcp(tool, ev.tool_input);
  }
  return parseFile(tool as FileTool, ev.tool_input, ev.cwd);
}

function parseBash(input: Record<string, unknown>): ParsedEvent {
  const raw = input.command;
  if (typeof raw !== "string") {
    throw new MalformedPayloadError("Bash tool_input.command is not a string");
  }
  if (raw.includes("\0")) {
    throw new ParseUnsafeError("Bash command contains null byte");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized === "") {
    throw new MalformedPayloadError("Bash command is empty after normalization");
  }
  const firstToken = normalized.split(" ")[0] ?? "";
  return {
    tool: "Bash",
    rawCommand: raw,
    normalizedCommand: normalized,
    firstToken,
  };
}

function parseApplyPatch(input: Record<string, unknown>): ParsedEvent {
  const patchText = patchTextFromInput(input);
  if (patchText === null) {
    throw new MalformedPayloadError("apply_patch tool_input has no patch text (input/patch)");
  }
  if (patchText.includes("\0")) {
    throw new ParseUnsafeError("apply_patch text contains null byte");
  }
  // A patch with no recognizable file-op header yields zero ops; the mapping
  // layer then abstains rather than guessing what files are touched.
  const ops = parseApplyPatchOps(patchText);
  return { tool: "apply_patch", ops };
}

function parseFile(
  tool: FileTool,
  input: Record<string, unknown>,
  cwd: string | undefined,
): ParsedEvent {
  const raw = input.file_path;
  if (typeof raw !== "string") {
    throw new MalformedPayloadError(`${tool} tool_input.file_path is not a string`);
  }
  if (raw.includes("\0")) {
    throw new ParseUnsafeError(`${tool} file_path contains null byte`);
  }
  let expanded = raw;
  if (expanded.startsWith("~")) {
    expanded = expanded.replace(/^~/, homedir());
  }
  const base = cwd ?? process.cwd();
  const absolute = pathResolve(base, expanded);
  // Strip a leading slash to produce a relative-style normalized path for matching.
  const normalized = absolute.replace(/^\/+/, "").replace(/\/+/g, "/");
  return {
    tool,
    rawPath: raw,
    normalizedPath: normalized,
  };
}

function parseWebFetch(input: Record<string, unknown>): ParsedEvent {
  const rawUrl = input.url;
  if (typeof rawUrl !== "string") {
    throw new MalformedPayloadError("WebFetch tool_input.url is not a string");
  }
  const { host, scope } = parseAndClassifyUrl(rawUrl);
  return { tool: "WebFetch", rawUrl, host, scope };
}

function parseWebSearch(input: Record<string, unknown>): ParsedEvent {
  const query = input.query;
  if (typeof query !== "string") {
    throw new MalformedPayloadError("WebSearch tool_input.query is not a string");
  }
  return { tool: "WebSearch", query };
}

function parseMcp(toolName: string, toolInput: Record<string, unknown>): ParsedEvent {
  return {
    tool: toolName as `mcp__${string}__${string}`,
    toolName,
    toolInput,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

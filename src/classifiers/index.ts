import { splitMcpToolName } from "../mcp-name.js";
import type { ClassifierResult, MCPParsed } from "../types.js";
import { gitClassifier } from "./git.js";
import { npmClassifier, npmFamilies } from "./npm.js";
import { dockerClassifier } from "./docker.js";
import { ghClassifier } from "./gh.js";
import { rmClassifier, rmFamilies } from "./rm.js";
import { pipeToShellClassifier } from "./pipe-to-shell.js";
import { secretReaderClassifier, secretReaderFamilies } from "./secret-reader.js";
import { filesystemClassifier } from "./mcp/filesystem.js";
import { githubClassifier } from "./mcp/github.js";
import { slackClassifier } from "./mcp/slack.js";

type ClassifierFn = (normalizedCommand: string) => ClassifierResult;

const REGISTRY: Record<string, ClassifierFn> = {
  git: gitClassifier,
  docker: dockerClassifier,
  gh: ghClassifier,
};
for (const fam of npmFamilies) REGISTRY[fam] = npmClassifier;
for (const fam of rmFamilies) REGISTRY[fam] = rmClassifier;
for (const fam of secretReaderFamilies) REGISTRY[fam] = secretReaderClassifier;

export function dispatchClassifier(firstToken: string, normalizedCommand: string): ClassifierResult {
  // Pipe-to-shell runs before family dispatch: a pipeline feeding a shell
  // executes arbitrary code regardless of the producer, and execute is the
  // highest-precedence verb in the effect set (canon pipe_to_shell).
  const piped = pipeToShellClassifier(normalizedCommand);
  if (piped.kind !== "NotApplicable") return piped;
  const fn = REGISTRY[firstToken];
  if (!fn) return { kind: "NotApplicable" };
  return fn(normalizedCommand);
}

type McpClassifierFn = (tool: string, input: Record<string, unknown>) => ClassifierResult;

const MCP_REGISTRY: Record<string, McpClassifierFn> = {
  filesystem: filesystemClassifier,
  github: githubClassifier,
  slack: slackClassifier,
};

export function dispatchMcpClassifier(parsed: MCPParsed): ClassifierResult {
  const parts = splitMcpToolName(parsed.toolName);
  if (!parts) return { kind: "NotApplicable" };
  const fn = MCP_REGISTRY[parts.server];
  if (!fn) return { kind: "NotApplicable" };
  return fn(parts.tool, parsed.toolInput);
}

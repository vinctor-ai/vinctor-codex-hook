import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseEvent } from "../src/parser.js";
import { resolve } from "../src/mapping.js";
import type { HookConfig } from "../src/types.js";

/**
 * Vinctor Action Taxonomy conformance suite.
 *
 * Fixtures are vendored verbatim from vinctor-conformance (canon v1). For each
 * fixture this test constructs the NATIVE Codex PreToolUse payload for
 * (family, operation, params), runs the real parser + mapper, and asserts the
 * resulting (action, resource) equals the canon's expectation.
 *
 * The run also emits test/conformance/result.json in the matrix result format
 * (adapter, fixtures_version, results[{id, status, got}]), consumed by
 * vinctor-conformance's tools/matrix.mjs.
 */

type Fixture = {
  id: string;
  family: "filesystem" | "github" | "shell" | "slack";
  operation: string;
  params: Record<string, unknown>;
  expected: { action: string; resource: string };
};

type ResultEntry = {
  id: string;
  status: "agrees" | "disagrees" | "unmapped";
  got?: { action: string; resource: string };
};

/**
 * Fixtures this adapter can classify but cannot bring to full agreement, with
 * the exact (action, resource) it produces instead. Empty at fixtures v1:
 * every applicable fixture agrees. Entries here are asserted exactly and
 * recorded honestly as `disagrees` in result.json — never faked to agree.
 */
const KNOWN_DIVERGENCES: Record<string, { action: string; resource: string }> = {};

// --- native input builders ---------------------------------------------------

const str = (v: unknown): string => {
  assert.equal(typeof v, "string", `expected string param, got ${typeof v}`);
  return v as string;
};

/** docker image reference for (registry, image, tag): docker.io stays implicit. */
function dockerRef(params: Record<string, unknown>): string {
  const registry = str(params.registry);
  const image = str(params.image);
  const tag = str(params.tag);
  return registry === "docker.io" ? `${image}:${tag}` : `${registry}/${image}:${tag}`;
}

function buildShellCommand(op: string, params: Record<string, unknown>): string {
  switch (op) {
    case "git status":
    case "git log":
    case "git diff":
    case "git show":
    case "git fetch":
    case "git stash":
    case "git pull":
    case "git reset --hard":
    case "git clean -f":
    case "npm test":
    case "npm install":
    case "npm ci":
      return op;
    case "npm publish":
      // The workspace spelling is the realistic native call that names the
      // package in command text (the bare spelling reads package.json).
      return `npm publish --workspace ${str(params.name)}`;
    case "git add":
      return "git add .";
    case "git commit":
      return "git commit -m update";
    case "git clone":
      return `git clone ${str(params.url)}`;
    case "git push":
      // A text classifier resolves owner/repo from an explicit URL remote.
      return `git push https://github.com/${str(params.owner)}/${str(params.repo)}.git ${str(params.branch)}`;
    case "git push --force":
      return `git push --force https://github.com/${str(params.owner)}/${str(params.repo)}.git ${str(params.branch)}`;
    case "git branch -D":
      return "git branch -D old-branch";
    case "npm run":
      return `npm run ${str(params.script)}`;
    case "npx":
      return `npx ${str(params.package)}`;
    case "docker build":
      return `docker build -t ${dockerRef(params)} .`;
    case "docker run":
      return `docker run --rm ${dockerRef(params)}`;
    case "docker push":
      return `docker push ${dockerRef(params)}`;
    case "docker rmi":
      return `docker rmi ${dockerRef(params)}`;
    case "rm":
      return `rm /${str(params.path)}`;
    case "rmdir":
      return `rmdir /${str(params.path)}`;
    case "pipe_to_shell":
      return `${str(params.first_token)} -fsSL ${str(params.url)} | sh`;
    case "gh pr merge":
      return `gh pr merge ${String(params.pull_number)} --repo ${str(params.owner)}/${str(params.repo)}`;
    case "gh release create":
      return `gh release create ${str(params.tag)} --repo ${str(params.owner)}/${str(params.repo)}`;
    case "gh secret set":
      return `gh secret set ${str(params.secret_name)} --repo ${str(params.owner)}/${str(params.repo)}`;
    default:
      throw new Error(`no native builder for shell operation: ${op}`);
  }
}

/** Canonical slack operation → native (tool, input) on the servers we classify. */
function buildSlackCall(op: string, params: Record<string, unknown>): { tool: string; input: Record<string, unknown> } {
  switch (op) {
    case "list_channels":
      return { tool: "slack_list_channels", input: {} };
    case "get_messages":
      return { tool: "slack_get_channel_history", input: { channel_id: str(params.channel), limit: 20 } };
    case "conversations_history":
      return { tool: "conversations_history", input: { channel_id: str(params.channel) } };
    case "post_message":
      return { tool: "slack_post_message", input: { channel_id: str(params.channel), text: str(params.text) } };
    case "send_message":
      return { tool: "conversations_add_message", input: { channel_id: str(params.channel), payload: str(params.text) } };
    case "reply":
      return { tool: "slack_reply_to_thread", input: { channel_id: str(params.channel), thread_ts: str(params.thread_ts), text: str(params.text) } };
    case "add_reaction":
      return { tool: "slack_add_reaction", input: { channel_id: str(params.channel), timestamp: str(params.timestamp), reaction: str(params.emoji) } };
    default:
      throw new Error(`no native builder for slack operation: ${op}`);
  }
}

function buildEvent(fx: Fixture): { hook_event_name: "PreToolUse"; tool_name: string; tool_input: Record<string, unknown> } {
  switch (fx.family) {
    case "shell":
      return { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: buildShellCommand(fx.operation, fx.params) } };
    case "github":
      // Canonical operation names are the native tool names on the github MCP server.
      return { hook_event_name: "PreToolUse", tool_name: `mcp__github__${fx.operation}`, tool_input: { ...fx.params } };
    case "filesystem": {
      const input: Record<string, unknown> = { ...fx.params };
      // Path params arrive in resource-path form; the native call uses absolute paths.
      for (const key of ["path", "source", "destination"]) {
        if (typeof input[key] === "string") input[key] = `/${input[key]}`;
      }
      return { hook_event_name: "PreToolUse", tool_name: `mcp__filesystem__${fx.operation}`, tool_input: input };
    }
    case "slack": {
      const { tool, input } = buildSlackCall(fx.operation, fx.params);
      return { hook_event_name: "PreToolUse", tool_name: `mcp__slack__${tool}`, tool_input: input };
    }
  }
}

// --- suite --------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url)); // dist/test at runtime
const conformanceDir = join(here, "..", "..", "test", "conformance");
const vendored = JSON.parse(readFileSync(join(conformanceDir, "fixtures.json"), "utf8")) as {
  fixtures_version: number;
  fixtures: Fixture[];
};

const EMPTY_CONFIG: HookConfig = { version: 1, rules: [] };
const results: ResultEntry[] = [];

describe(`taxonomy conformance (fixtures v${vendored.fixtures_version}, ${vendored.fixtures.length} fixtures)`, () => {
  for (const fx of vendored.fixtures) {
    it(`${fx.id}: ${fx.operation} → ${fx.expected.action}:${fx.expected.resource}`, () => {
      const event = buildEvent(fx);
      const mapping = resolve(parseEvent(event), EMPTY_CONFIG);

      if (mapping.kind !== "Mapped") {
        results.push({ id: fx.id, status: "unmapped" });
        assert.fail(`fixture ${fx.id} is unmapped (expected ${fx.expected.action}:${fx.expected.resource})`);
      }

      const got = { action: mapping.action as string, resource: mapping.resource };
      const agrees = got.action === fx.expected.action && got.resource === fx.expected.resource;
      results.push({ id: fx.id, status: agrees ? "agrees" : "disagrees", got });

      const divergence = KNOWN_DIVERGENCES[fx.id];
      if (divergence) {
        assert.deepEqual(got, divergence, `${fx.id}: documented divergence drifted`);
        assert.ok(!agrees, `${fx.id} now agrees with the canon — remove it from KNOWN_DIVERGENCES`);
        return;
      }
      assert.deepEqual(got, fx.expected, `${fx.id} diverges from canon`);
    });
  }

  after(() => {
    // Matrix result format — consumed by vinctor-conformance tools/matrix.mjs.
    const resultFile = {
      adapter: "codex-hook",
      fixtures_version: vendored.fixtures_version,
      results,
    };
    mkdirSync(conformanceDir, { recursive: true });
    writeFileSync(join(conformanceDir, "result.json"), JSON.stringify(resultFile, null, 2) + "\n");
  });
});

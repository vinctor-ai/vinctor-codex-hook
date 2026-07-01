import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { githubClassifier } from "../../../src/classifiers/mcp/github.js";
import type { ClassifierResult } from "../../../src/types.js";
import { dispatchMcpClassifier } from "../../../src/classifiers/index.js";
import { resolve } from "../../../src/mapping.js";
import type { MCPParsed } from "../../../src/types.js";

const m = (action: string, resource: string): ClassifierResult =>
  ({ kind: "Mapped", action: action as any, resource });
const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };
const OR = { owner: "acme", repo: "api" };

describe("githubClassifier — reads", () => {
  it("repo-scoped reads → read:github/<o>/<r>/<kind>", () => {
    assert.deepEqual(githubClassifier("get_file_contents", { ...OR, path: "README.md" }), m("read", "github/acme/api/file"));
    assert.deepEqual(githubClassifier("list_commits", OR), m("read", "github/acme/api/code"));
    assert.deepEqual(githubClassifier("list_branches", OR), m("read", "github/acme/api/branch"));
    assert.deepEqual(githubClassifier("list_releases", OR), m("read", "github/acme/api/release"));
    assert.deepEqual(githubClassifier("issue_read", { ...OR, issue_number: 5, method: "get" }), m("read", "github/acme/api/issue"));
    assert.deepEqual(githubClassifier("pull_request_read", { ...OR, pullNumber: 3, method: "get_diff" }), m("read", "github/acme/api/pr"));
    assert.deepEqual(githubClassifier("actions_list", { ...OR, method: "list_workflows" }), m("read", "github/acme/api/workflow"));
    assert.deepEqual(githubClassifier("get_code_scanning_alert", { ...OR, alertNumber: 1 }), m("read", "github/acme/api/security"));
  });
  it("global reads → github/_/<kind>", () => {
    assert.deepEqual(githubClassifier("get_me", {}), m("read", "github/_/context"));
    assert.deepEqual(githubClassifier("search_users", { query: "alice" }), m("read", "github/_/context"));
    assert.deepEqual(githubClassifier("search_repositories", { query: "x" }), m("read", "github/_/repo"));
    assert.deepEqual(githubClassifier("search_code", { query: "x" }), m("read", "github/_/code"));
  });
  it("owner-scoped read with owner present → github/<o>/_/<kind>", () => {
    assert.deepEqual(githubClassifier("list_issue_types", { owner: "acme" }), m("read", "github/acme/_/issue"));
  });
  it("flex read uses repo when present, else owner, else global", () => {
    assert.deepEqual(githubClassifier("search_issues", { query: "x", ...OR }), m("read", "github/acme/api/issue"));
    assert.deepEqual(githubClassifier("search_issues", { query: "x" }), m("read", "github/_/issue"));
  });
});

describe("githubClassifier — mutations", () => {
  it("writes", () => {
    assert.deepEqual(githubClassifier("create_or_update_file", { ...OR, path: "a", content: "x", message: "m", branch: "main" }), m("write", "github/acme/api/file"));
    assert.deepEqual(githubClassifier("push_files", { ...OR, branch: "main", files: [], message: "m" }), m("write", "github/acme/api/code"));
    assert.deepEqual(githubClassifier("create_branch", { ...OR, branch: "f" }), m("write", "github/acme/api/branch"));
    assert.deepEqual(githubClassifier("create_pull_request", { ...OR, title: "t", head: "f", base: "main" }), m("write", "github/acme/api/pr"));
    assert.deepEqual(githubClassifier("issue_write", { ...OR, method: "create", title: "t" }), m("write", "github/acme/api/issue"));
    assert.deepEqual(githubClassifier("update_issue_state", { ...OR, issue_number: 1, state: "closed" }), m("write", "github/acme/api/issue"));
  });
  it("delete_file → delete", () => {
    assert.deepEqual(githubClassifier("delete_file", { ...OR, path: "x", message: "m", branch: "main" }), m("delete", "github/acme/api/file"));
  });
  it("merge_pull_request → deploy", () => {
    assert.deepEqual(githubClassifier("merge_pull_request", { ...OR, pullNumber: 7, merge_method: "squash" }), m("deploy", "github/acme/api/pr"));
  });
  it("create_repository → write:github/_/repo (global)", () => {
    assert.deepEqual(githubClassifier("create_repository", { name: "svc", private: true }), m("write", "github/_/repo"));
  });
  it("fork_repository → write:github/<o>/<r>/fork", () => {
    assert.deepEqual(githubClassifier("fork_repository", { ...OR, organization: "myorg" }), m("write", "github/acme/api/fork"));
  });
});

describe("githubClassifier — actions_run_trigger (multi-method)", () => {
  it("run/rerun → execute, cancel → write, delete_logs → delete", () => {
    assert.deepEqual(githubClassifier("actions_run_trigger", { ...OR, method: "run_workflow", workflow_id: "ci.yml", ref: "main" }), m("execute", "github/acme/api/workflow"));
    assert.deepEqual(githubClassifier("actions_run_trigger", { ...OR, method: "rerun_failed_jobs", run_id: 1 }), m("execute", "github/acme/api/workflow"));
    assert.deepEqual(githubClassifier("actions_run_trigger", { ...OR, method: "cancel_workflow_run", run_id: 1 }), m("write", "github/acme/api/workflow"));
    assert.deepEqual(githubClassifier("actions_run_trigger", { ...OR, method: "delete_workflow_run_logs", run_id: 1 }), m("delete", "github/acme/api/workflow"));
  });
  it("missing or unknown method → RBU", () => {
    assert.deepEqual(githubClassifier("actions_run_trigger", OR), RBU);
    assert.deepEqual(githubClassifier("actions_run_trigger", { ...OR, method: "nope" }), RBU);
  });
});

describe("githubClassifier — deprecated aliases", () => {
  it("read alias get_workflow_run → read; action aliases keep their verb", () => {
    assert.deepEqual(githubClassifier("get_workflow_run", { ...OR, run_id: 1 }), m("read", "github/acme/api/workflow"));
    assert.deepEqual(githubClassifier("run_workflow", { ...OR, workflow_id: "ci.yml", ref: "main" }), m("execute", "github/acme/api/workflow"));
    assert.deepEqual(githubClassifier("delete_workflow_run_logs", { ...OR, run_id: 1 }), m("delete", "github/acme/api/workflow"));
  });
});

describe("githubClassifier — secret scanning → secret/gh", () => {
  it("maps to secret/gh regardless of owner/repo", () => {
    assert.deepEqual(githubClassifier("get_secret_scanning_alert", { ...OR, alertNumber: 1 }), m("read", "secret/gh"));
    assert.deepEqual(githubClassifier("list_secret_scanning_alerts", OR), m("read", "secret/gh"));
  });
});

describe("githubClassifier — edge / unknown", () => {
  it("repo-scoped mutation missing owner or repo → RBU", () => {
    assert.deepEqual(githubClassifier("create_or_update_file", { repo: "api", path: "a", content: "x", message: "m", branch: "main" }), RBU);
    assert.deepEqual(githubClassifier("merge_pull_request", { owner: "acme", pullNumber: 1 }), RBU);
  });
  it("repo-scoped READ tolerates missing owner/repo (fallback resource)", () => {
    assert.deepEqual(githubClassifier("list_commits", {}), m("read", "github/_/code"));
    assert.deepEqual(githubClassifier("list_commits", { owner: "acme" }), m("read", "github/acme/_/code"));
  });
  it("unknown / out-of-scope github tool → RBU", () => {
    assert.deepEqual(githubClassifier("frob_widget", OR), RBU);
    assert.deepEqual(githubClassifier("create_gist", { filename: "x", content: "y" }), RBU);
    assert.deepEqual(githubClassifier("resolve_review_thread", { threadID: "x" }), RBU);
  });
  it("non-string/empty owner is treated as absent", () => {
    assert.deepEqual(githubClassifier("create_or_update_file", { owner: "", repo: "api", path: "a", content: "x", message: "m", branch: "main" }), RBU);
  });
});

const ghEvent = (toolName: string, toolInput: Record<string, unknown>): MCPParsed =>
  ({ tool: toolName as `mcp__${string}__${string}`, toolName, toolInput });

describe("github dispatch + resolve integration", () => {
  it("dispatchMcpClassifier routes mcp__github__<tool> to githubClassifier", () => {
    assert.deepEqual(
      dispatchMcpClassifier(ghEvent("mcp__github__get_me", {})),
      { kind: "Mapped", action: "read", resource: "github/_/context" });
  });
  it("resolve maps an mcp__github mutation via the classifier", () => {
    const r = resolve(ghEvent("mcp__github__create_or_update_file",
      { owner: "acme", repo: "api", path: "a", content: "x", message: "m", branch: "main" }) as any,
      { version: 1, rules: [] });
    assert.deepEqual(r, { kind: "Mapped", action: "write", resource: "github/acme/api/file", source: "classifier" });
  });
  it("operator config overrides the github classifier", () => {
    const config = { version: 1 as const, rules: [
      { tool: "mcp__github__get_me" as const, matchType: "exact" as const,
        pattern: "mcp__github__get_me", action: "read" as const, resource: "github/override" },
    ]};
    const r = resolve(ghEvent("mcp__github__get_me", {}) as any, config);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "github/override"); assert.equal(r.source, "config"); }
  });
  it("out-of-scope github tool → Unmapped (ask)", () => {
    assert.deepEqual(
      resolve(ghEvent("mcp__github__create_gist", { filename: "x", content: "y" }) as any, { version: 1, rules: [] }),
      { kind: "Unmapped" });
  });
});

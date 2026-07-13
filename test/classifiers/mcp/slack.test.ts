import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { slackClassifier } from "../../../src/classifiers/mcp/slack.js";
import type { ClassifierResult } from "../../../src/types.js";
import { dispatchMcpClassifier } from "../../../src/classifiers/index.js";
import { resolve } from "../../../src/mapping.js";
import type { MCPParsed } from "../../../src/types.js";

const m = (action: string, resource: string): ClassifierResult =>
  ({ kind: "Mapped", action: action as any, resource });
const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };
const C = "C01AB2CD3EF";

describe("slackClassifier — workspace reads → slack", () => {
  it("reference + korotovsky workspace reads", () => {
    for (const t of ["slack_list_channels", "slack_get_users", "slack_get_user_profile", "channels_list", "channels_me", "conversations_unreads", "users_search"]) {
      assert.deepEqual(slackClassifier(t, { limit: 10 }), m("read", "chat/slack"), t);
    }
  });
  it("get_user_profile is workspace-coarse even with user_id", () => {
    assert.deepEqual(slackClassifier("slack_get_user_profile", { user_id: "U01ABCDEFGH" }), m("read", "chat/slack"));
  });
});

describe("slackClassifier — channel reads → chat/slack/<channel>", () => {
  it("channel present", () => {
    assert.deepEqual(slackClassifier("slack_get_channel_history", { channel_id: C, limit: 20 }), m("read", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("conversations_history", { channel_id: C }), m("read", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("slack_get_thread_replies", { channel_id: C, thread_ts: "1700000000.1" }), m("read", `chat/slack/${C}`));
  });
  it("channel missing → workspace fallback (reads tolerate it)", () => {
    assert.deepEqual(slackClassifier("conversations_history", {}), m("read", "chat/slack"));
  });
});

describe("slackClassifier — sends → chat/slack/<channel>", () => {
  it("each send form", () => {
    assert.deepEqual(slackClassifier("slack_post_message", { channel_id: C, text: "hi" }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("slack_reply_to_thread", { channel_id: C, thread_ts: "1.2", text: "r" }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("slack_add_reaction", { channel_id: C, timestamp: "1.2", reaction: "thumbsup" }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("conversations_add_message", { channel_id: C, payload: "hi" }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("reactions_add", { channel_id: C, timestamp: "1.2", emoji: "x" }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("reactions_remove", { channel_id: C, timestamp: "1.2", emoji: "x" }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("conversations_join", { channel_id: C }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("conversations_leave", { channel_id: C }), m("send", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("conversations_mark", { channel_id: C, ts: "1.2" }), m("send", `chat/slack/${C}`));
  });
  it("DM and human-form targets pass through as-is", () => {
    assert.deepEqual(slackClassifier("slack_post_message", { channel_id: "D01DMUSER", text: "x" }), m("send", "chat/slack/D01DMUSER"));
    assert.deepEqual(slackClassifier("conversations_add_message", { channel_id: "#general", payload: "x" }), m("send", "chat/slack/#general"));
    assert.deepEqual(slackClassifier("conversations_add_message", { channel_id: "@john", payload: "x" }), m("send", "chat/slack/@john"));
  });
});

describe("slackClassifier — search", () => {
  it("filter_in_channel present → channel; absent → workspace", () => {
    assert.deepEqual(slackClassifier("conversations_search_messages", { search_query: "q", filter_in_channel: C }), m("read", `chat/slack/${C}`));
    assert.deepEqual(slackClassifier("conversations_search_messages", { search_query: "q" }), m("read", "chat/slack"));
  });
});

describe("slackClassifier — edge / unknown", () => {
  it("send tool with missing/empty/non-string/null-byte channel → RBU", () => {
    assert.deepEqual(slackClassifier("slack_post_message", { text: "x" }), RBU);
    assert.deepEqual(slackClassifier("slack_post_message", { channel_id: "", text: "x" }), RBU);
    assert.deepEqual(slackClassifier("slack_post_message", { channel_id: 42 as any, text: "x" }), RBU);
    assert.deepEqual(slackClassifier("slack_post_message", { channel_id: "C123\0evil", text: "x" }), RBU);
  });
  it("conversations_replies with channel present → read:chat/slack/<channel>", () => {
    assert.deepEqual(slackClassifier("conversations_replies", { channel_id: C, thread_ts: "1.2" }), m("read", `chat/slack/${C}`));
  });
  it("unknown / niche tool → RBU", () => {
    assert.deepEqual(slackClassifier("frob", { channel_id: C }), RBU);
    assert.deepEqual(slackClassifier("usergroups_create", { name: "g" }), RBU);
    assert.deepEqual(slackClassifier("saved_list", {}), RBU);
  });
});

const slEvent = (toolName: string, toolInput: Record<string, unknown>): MCPParsed =>
  ({ tool: toolName as `mcp__${string}__${string}`, toolName, toolInput });

describe("slack dispatch + resolve integration", () => {
  it("dispatchMcpClassifier routes mcp__slack__<tool> to slackClassifier", () => {
    assert.deepEqual(
      dispatchMcpClassifier(slEvent("mcp__slack__slack_list_channels", {})),
      { kind: "Mapped", action: "read", resource: "chat/slack" });
  });
  it("resolve maps an mcp__slack send via the classifier", () => {
    const r = resolve(slEvent("mcp__slack__slack_post_message", { channel_id: "C01AB2CD3EF", text: "hi" }) as any,
      { version: 1, rules: [] });
    assert.deepEqual(r, { kind: "Mapped", action: "send", resource: "chat/slack/C01AB2CD3EF", source: "classifier" });
  });
  it("operator config overrides the slack classifier", () => {
    const config = { version: 1 as const, rules: [
      { tool: "mcp__slack__slack_list_channels" as const, matchType: "exact" as const,
        pattern: "mcp__slack__slack_list_channels", action: "read" as const, resource: "slack/override" },
    ]};
    const r = resolve(slEvent("mcp__slack__slack_list_channels", {}) as any, config);
    assert.equal(r.kind, "Mapped");
    if (r.kind === "Mapped") { assert.equal(r.resource, "slack/override"); assert.equal(r.source, "config"); }
  });
  it("niche slack tool → Unmapped (ask)", () => {
    assert.deepEqual(
      resolve(slEvent("mcp__slack__saved_list", {}) as any, { version: 1, rules: [] }),
      { kind: "Unmapped" });
  });
});

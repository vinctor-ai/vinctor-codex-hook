import type { Action, ClassifierResult } from "../../types.js";

type Scope = "channel" | "workspace" | "search";
type Desc = { action: Action; scope: Scope };

const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };

const read = (scope: Scope): Desc => ({ action: "read", scope });
const send = (scope: Scope): Desc => ({ action: "send", scope });

const TOOL_TABLE: Record<string, Desc> = {
  // reference @modelcontextprotocol/server-slack (slack_*) + Zencoder fork
  slack_list_channels: read("workspace"),
  slack_get_users: read("workspace"),
  slack_get_user_profile: read("workspace"),
  slack_get_channel_history: read("channel"),
  slack_get_thread_replies: read("channel"),
  slack_post_message: send("channel"),
  slack_reply_to_thread: send("channel"),
  slack_add_reaction: send("channel"),

  // korotovsky slack-mcp-server
  channels_list: read("workspace"),
  channels_me: read("workspace"),
  conversations_unreads: read("workspace"),
  users_search: read("workspace"),
  conversations_history: read("channel"),
  conversations_replies: read("channel"),
  conversations_search_messages: read("search"),
  conversations_add_message: send("channel"),
  conversations_join: send("channel"),
  conversations_leave: send("channel"),
  conversations_mark: send("channel"),
  reactions_add: send("channel"),
  reactions_remove: send("channel"),
};

function strField(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 && !v.includes("\0") ? v : undefined;
}

export function slackClassifier(tool: string, input: Record<string, unknown>): ClassifierResult {
  const desc = TOOL_TABLE[tool];
  if (!desc) return RBU; // unknown / out-of-scope / hosted-server tool

  const { action } = desc;

  switch (desc.scope) {
    case "workspace":
      return { kind: "Mapped", action, resource: "chat/slack" };
    case "channel": {
      const target = strField(input.channel_id);
      if (target) return { kind: "Mapped", action, resource: `chat/slack/${target}` };
      if (action === "send") return RBU; // never send to an ambiguous target
      return { kind: "Mapped", action: "read", resource: "chat/slack" };
    }
    case "search": {
      const target = strField(input.filter_in_channel);
      return {
        kind: "Mapped",
        action: "read",
        resource: target ? `chat/slack/${target}` : "chat/slack",
      };
    }
  }
}

#!/usr/bin/env node
// Coverage-measurement probe (NOT the hook). Wired as a Codex PreToolUse hook to
// answer one question: for which tool_name does Codex actually emit a PreToolUse
// event on this build?
//
// It reads the hook event JSON on stdin, appends ONLY `{hook_event_name,
// tool_name}` to $VINCTOR_COVERAGE_LOG (one JSON object per line), and returns an
// `allow` decision so the agent keeps running and exercises more tools.
//
// Non-disclosure: it logs the tool NAME only. It never persists `tool_input`
// (raw command / patch / path), and the Codex PreToolUse event carries no
// grant_ref. This is a measurement instrument; it does not classify, map, call
// /v1/enforce, or change any hook behavior.

import { appendFileSync } from "node:fs";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let toolName = "<unparseable>";
  let eventName = "<unknown>";
  try {
    const ev = JSON.parse(raw);
    if (typeof ev?.tool_name === "string") toolName = ev.tool_name;
    if (typeof ev?.hook_event_name === "string") eventName = ev.hook_event_name;
  } catch {
    // leave the placeholders
  }
  const log = process.argv[2] ?? process.env.VINCTOR_COVERAGE_LOG;
  if (log) {
    try {
      // Invocation marker: written on EVERY call regardless of whether a usable
      // tool_name was parsed. Its mere presence proves the wrapper ran at least
      // once (i.e. hooks.json WAS loaded by this Codex build), letting measure.sh
      // distinguish "wrapper never invoked" from "Codex emitted zero PreToolUse".
      appendFileSync(log, JSON.stringify({ __wrapper_invoked__: true, hook_event_name: eventName, tool_name: toolName }) + "\n");
    } catch {
      // never break the agent run on a logging failure
    }
  }
  // Allow so the session proceeds and surfaces more tool calls.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    }),
  );
  process.exit(0);
});

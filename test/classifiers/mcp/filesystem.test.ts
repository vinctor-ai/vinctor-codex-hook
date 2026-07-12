import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { filesystemClassifier } from "../../../src/classifiers/mcp/filesystem.js";
import type { ClassifierResult } from "../../../src/types.js";
import { dispatchMcpClassifier } from "../../../src/classifiers/index.js";
import type { MCPParsed } from "../../../src/types.js";

const mapped = (action: string, resource: string): ClassifierResult =>
  ({ kind: "Mapped", action: action as any, resource });
const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };

describe("filesystemClassifier — reads", () => {
  it("read_text_file → read:fs/<path>", () => {
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/project/src/main.ts" }),
      mapped("read", "fs/project/src/main.ts"));
  });
  it("read_file (deprecated alias) behaves like read_text_file", () => {
    assert.deepEqual(filesystemClassifier("read_file", { path: "/project/src/main.ts" }),
      mapped("read", "fs/project/src/main.ts"));
  });
  it("list_directory / directory_tree / search_files / get_file_info → read", () => {
    for (const t of ["list_directory", "list_directory_with_sizes", "directory_tree", "search_files", "get_file_info", "read_media_file"]) {
      assert.deepEqual(filesystemClassifier(t, { path: "/project" }), mapped("read", "fs/project"), t);
    }
  });
  it("list_allowed_directories (no path) → read:fs/_allowed-dirs", () => {
    assert.deepEqual(filesystemClassifier("list_allowed_directories", {}), mapped("read", "fs/_allowed-dirs"));
  });
});

describe("filesystemClassifier — writes / deletes", () => {
  it("write_file / edit_file / create_directory → write:fs/<path>", () => {
    for (const t of ["write_file", "edit_file", "create_directory"]) {
      assert.deepEqual(filesystemClassifier(t, { path: "/project/out.txt" }), mapped("write", "fs/project/out.txt"), t);
    }
  });
  it("edit_file with dryRun is still write (no action downgrade)", () => {
    assert.deepEqual(filesystemClassifier("edit_file", { path: "/p/a.ts", edits: [], dryRun: true }),
      mapped("write", "fs/p/a.ts"));
  });
  it("delete_file / delete_directory → delete:fs/<path>", () => {
    for (const t of ["delete_file", "delete_directory"]) {
      assert.deepEqual(filesystemClassifier(t, { path: "/project/junk" }), mapped("delete", "fs/project/junk"), t);
    }
  });
});

describe("filesystemClassifier — sensitive paths", () => {
  it("maps sensitive single-path reads/writes to secret/<kind>", () => {
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/home/u/.env" }), mapped("read", "secret/env"));
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/home/u/.ssh/id_rsa" }), mapped("read", "secret/ssh"));
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/home/u/cert.pem" }), mapped("read", "secret/ssh"));
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/home/u/.aws/credentials" }), mapped("read", "secret/aws"));
    assert.deepEqual(filesystemClassifier("write_file", { path: "/project/.env", content: "x" }), mapped("write", "secret/env"));
  });
});

describe("filesystemClassifier — move_file", () => {
  it("normal move → write:fs/<destination>", () => {
    assert.deepEqual(filesystemClassifier("move_file", { source: "/p/old.txt", destination: "/p/new.txt" }),
      mapped("write", "fs/p/new.txt"));
  });
  it("sensitive source → write:secret/<kind>", () => {
    assert.deepEqual(filesystemClassifier("move_file", { source: "/home/u/.env", destination: "/tmp/x" }),
      mapped("write", "secret/env"));
  });
  it("sensitive destination → write:secret/<kind>", () => {
    assert.deepEqual(filesystemClassifier("move_file", { source: "/tmp/x", destination: "/home/u/.aws/credentials" }),
      mapped("write", "secret/aws"));
  });
  it("missing source or destination → RBU", () => {
    assert.deepEqual(filesystemClassifier("move_file", { source: "/p/a" }), RBU);
  });
});

describe("filesystemClassifier — read_multiple_files", () => {
  it("any sensitive path → read:secret/<kind>", () => {
    assert.deepEqual(filesystemClassifier("read_multiple_files", { paths: ["/p/a.ts", "/home/u/.env", "/p/b.ts"] }),
      mapped("read", "secret/env"));
  });
  it("all non-sensitive → RBU (cannot represent N paths as one resource)", () => {
    assert.deepEqual(filesystemClassifier("read_multiple_files", { paths: ["/p/a.ts", "/p/b.ts"] }), RBU);
  });
  it("empty or malformed array → RBU", () => {
    assert.deepEqual(filesystemClassifier("read_multiple_files", { paths: [] }), RBU);
    assert.deepEqual(filesystemClassifier("read_multiple_files", { paths: [123] as any }), RBU);
  });
});

describe("filesystemClassifier — unsafe / unknown", () => {
  it("missing / non-string / empty / null-byte path → RBU", () => {
    assert.deepEqual(filesystemClassifier("read_text_file", {}), RBU);
    assert.deepEqual(filesystemClassifier("read_text_file", { path: 42 as any }), RBU);
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "" }), RBU);
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/p/a\0.txt" }), RBU);
  });
  it("unknown filesystem tool → RBU", () => {
    assert.deepEqual(filesystemClassifier("copy_file", { path: "/p/a" }), RBU);
  });
  it("path that normalizes to empty (e.g. \"/\") → RBU", () => {
    assert.deepEqual(filesystemClassifier("read_text_file", { path: "/" }), RBU);
    assert.deepEqual(filesystemClassifier("move_file", { source: "/tmp/x", destination: "/" }), RBU);
  });
});

const ev = (toolName: string, toolInput: Record<string, unknown>): MCPParsed =>
  ({ tool: toolName as `mcp__${string}__${string}`, toolName, toolInput });

describe("dispatchMcpClassifier", () => {
  it("routes mcp__filesystem__<tool> to the filesystem classifier", () => {
    assert.deepEqual(
      dispatchMcpClassifier(ev("mcp__filesystem__read_text_file", { path: "/p/a.ts" })),
      { kind: "Mapped", action: "read", resource: "fs/p/a.ts" });
  });
  it("splits server/tool correctly for tool names containing underscores", () => {
    assert.deepEqual(
      dispatchMcpClassifier(ev("mcp__filesystem__read_multiple_files", { paths: ["/home/u/.env"] })),
      { kind: "Mapped", action: "read", resource: "secret/env" });
  });
  it("unknown server → NotApplicable", () => {
    assert.deepEqual(dispatchMcpClassifier(ev("mcp__postgres__query", { sql: "SELECT 1" })),
      { kind: "NotApplicable" });
  });
});

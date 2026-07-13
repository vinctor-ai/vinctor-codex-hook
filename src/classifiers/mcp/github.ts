import type { Action, ClassifierResult } from "../../types.js";

// Canon kinds are pr/issue/workflow/release/contents/secret; the grammar
// collapses file/code/branch into `contents`. Non-canon kinds (repo, fork,
// security, context, collaborator) cover out-of-canon operations.
type Kind =
  | "contents" | "release" | "collaborator" | "repo"
  | "fork" | "issue" | "pr" | "workflow" | "security" | "context" | "secret";
type Scope = "repo" | "owner" | "global" | "flex";

type Desc = {
  action: Action | "mm";
  kind?: Kind;
  scope?: Scope;
  methods?: Record<string, Action>;
};

const RBU: ClassifierResult = { kind: "RecognizedButUnclassified" };

// descriptor builders (scope defaults to "repo")
const r = (kind: Kind, scope: Scope = "repo"): Desc => ({ action: "read", kind, scope });
const w = (kind: Kind, scope: Scope = "repo"): Desc => ({ action: "write", kind, scope });
const d = (kind: Kind, scope: Scope = "repo"): Desc => ({ action: "delete", kind, scope });

const TOOL_TABLE: Record<string, Desc> = {
  // context / users / search
  get_me: r("context", "global"),
  get_teams: r("context", "global"),
  get_team_members: r("context", "owner"),
  search_users: r("context", "global"),
  search_repositories: r("repo", "global"),
  search_code: r("contents", "global"),
  search_commits: r("contents", "global"),

  // repos / git — the canon grammar collapses file/code/branch kinds into contents
  get_file_contents: r("contents"),
  get_repository_tree: r("contents"),
  list_commits: r("contents"),
  get_commit: r("contents"),
  list_branches: r("contents"),
  list_tags: r("contents"),
  get_tag: r("contents"),
  list_releases: r("release"),
  get_release: r("release"),
  get_latest_release: r("release"),
  get_release_by_tag: r("release"),
  list_repository_collaborators: r("collaborator"),
  create_or_update_file: w("contents"),
  push_files: w("contents"),
  create_branch: w("contents"),
  delete_file: d("contents"),
  create_repository: w("repo", "global"),
  fork_repository: w("fork"),

  // releases — publishing is externally effective (canon: deploy)
  create_release: { action: "deploy", kind: "release", scope: "repo" },
  publish_release: { action: "deploy", kind: "release", scope: "repo" },

  // issues
  issue_read: r("issue"),
  get_issue: r("issue"),
  list_issues: r("issue"),
  search_issues: r("issue", "flex"),
  list_issue_types: r("issue", "owner"),
  issue_write: w("issue"),
  add_issue_comment: w("issue"),
  sub_issue_write: w("issue"),
  create_issue: w("issue"),
  update_issue: w("issue"),
  update_issue_title: w("issue"),
  update_issue_body: w("issue"),
  update_issue_assignees: w("issue"),
  update_issue_labels: w("issue"),
  update_issue_milestone: w("issue"),
  update_issue_type: w("issue"),
  update_issue_state: w("issue"),
  add_sub_issue: w("issue"),
  remove_sub_issue: w("issue"),
  reprioritize_sub_issue: w("issue"),
  set_issue_fields: w("issue"),

  // pull_requests
  pull_request_read: r("pr"),
  get_pull_request: r("pr"),
  list_pull_requests: r("pr"),
  search_pull_requests: r("pr", "flex"),
  create_pull_request: w("pr"),
  update_pull_request: w("pr"),
  update_pull_request_branch: w("pr"),
  pull_request_review_write: w("pr"),
  add_comment_to_pending_review: w("pr"),
  add_reply_to_pull_request_comment: w("pr"),
  merge_pull_request: { action: "deploy", kind: "pr", scope: "repo" },
  update_pull_request_title: w("pr"),
  update_pull_request_body: w("pr"),
  update_pull_request_state: w("pr"),
  update_pull_request_draft_state: w("pr"),
  request_pull_request_reviewers: w("pr"),
  create_pull_request_review: w("pr"),
  submit_pending_pull_request_review: w("pr"),
  delete_pending_pull_request_review: w("pr"),
  add_pull_request_review_comment: w("pr"),

  // actions
  actions_list: r("workflow"),
  actions_get: r("workflow"),
  get_job_logs: r("workflow"),
  actions_run_trigger: {
    action: "mm", kind: "workflow", scope: "repo",
    methods: {
      run_workflow: "execute",
      rerun_workflow_run: "execute",
      rerun_failed_jobs: "execute",
      cancel_workflow_run: "write",
      delete_workflow_run_logs: "delete",
    },
  },
  // deprecated workflow read aliases
  list_workflows: r("workflow"),
  list_workflow_runs: r("workflow"),
  list_workflow_jobs: r("workflow"),
  list_workflow_run_artifacts: r("workflow"),
  get_workflow: r("workflow"),
  get_workflow_run: r("workflow"),
  get_workflow_job: r("workflow"),
  get_workflow_run_usage: r("workflow"),
  get_workflow_run_logs: r("workflow"),
  get_workflow_job_logs: r("workflow"),
  download_workflow_run_artifact: r("workflow"),
  // deprecated workflow action aliases (single-purpose)
  run_workflow: { action: "execute", kind: "workflow", scope: "repo" },
  rerun_workflow_run: { action: "execute", kind: "workflow", scope: "repo" },
  rerun_failed_jobs: { action: "execute", kind: "workflow", scope: "repo" },
  cancel_workflow_run: { action: "write", kind: "workflow", scope: "repo" },
  delete_workflow_run_logs: { action: "delete", kind: "workflow", scope: "repo" },

  // code_security / dependabot
  get_code_scanning_alert: r("security"),
  list_code_scanning_alerts: r("security"),
  get_dependabot_alert: r("security"),
  list_dependabot_alerts: r("security"),

  // secret_protection → the repo's secret kind (canon: github/<o>/<r>/secret)
  get_secret_scanning_alert: r("secret"),
  list_secret_scanning_alerts: r("secret"),
};

function strField(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 && !v.includes("\0") ? v : undefined;
}

export function githubClassifier(tool: string, input: Record<string, unknown>): ClassifierResult {
  const desc = TOOL_TABLE[tool];
  if (!desc) return RBU; // unknown / out-of-scope tool on a known server

  let action: Action;
  if (desc.action === "mm") {
    const method = strField(input.method);
    if (!method) return RBU;
    const a = desc.methods![method];
    if (!a) return RBU;
    action = a;
  } else {
    action = desc.action;
  }

  const owner = strField(input.owner);
  const repo = strField(input.repo);
  const kind = desc.kind!;
  const isRead = action === "read";

  let resource: string;
  switch (desc.scope) {
    case "global":
      resource = `github/_/${kind}`;
      break;
    case "owner":
      if (owner) resource = `github/${owner}/_/${kind}`;
      else if (isRead) resource = `github/_/${kind}`;
      else return RBU;
      break;
    case "flex":
      resource = owner && repo ? `github/${owner}/${repo}/${kind}`
        : owner ? `github/${owner}/_/${kind}`
          : `github/_/${kind}`;
      break;
    case "repo":
    default:
      if (owner && repo) resource = `github/${owner}/${repo}/${kind}`;
      else if (isRead) resource = owner ? `github/${owner}/_/${kind}` : `github/_/${kind}`;
      else return RBU; // never mutate an ambiguous target
      break;
  }

  return { kind: "Mapped", action, resource };
}

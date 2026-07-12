# Contributing

This repository is a Boundary Preview adapter: the Codex `PreToolUse`
authorization boundary and its operator tooling. Keep changes scoped to that
boundary and its config/CLI surface.

## Quality Gates

Before committing, run the full suite (build is included):

```bash
npm test                 # unit + build
npm run test:integration # mock-service integration
```

CI runs the same on Node 20 and 22; PRs must be green.

## Conventions

- **Test-first.** New behavior or a bug fix lands with a test that fails before
  the change and passes after.
- **Fail closed.** No change may turn a deny (or an error) into an allow. The
  deny-reason templates are a fixed, leak-free set — do not interpolate tool
  input (URLs, paths, commands) into a `permissionDecisionReason`; the
  no-disclosure tests enforce this.
- **Surgical diffs.** Match the surrounding style; don't refactor unrelated code.

## Reporting Security Issues

See [SECURITY.md](SECURITY.md) — do not use public issues for vulnerabilities.

# Security Policy

Vinctor is a runtime authorization layer for AI agents, so we take security
reports seriously. This repository is the Codex `PreToolUse` hook adapter.

## Reporting a Vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[**Report a vulnerability**](../../security/advisories/new) flow
(the repository's *Security* tab -> *Advisories*). We aim to acknowledge a
report within 5 business days and will keep you updated on remediation.

When you can, include: affected version/commit, a description of the impact, and
a minimal reproduction.

## Scope and Maturity

This is an **early preview** and is labelled as such. It runs as a *cooperative*
agent-side hook: an agent that controls its own runtime can route around it (a
resource-side enforcement point is the stronger control). For the full picture of
what Vinctor does and does not defend against, see the
[threat model](https://github.com/vinctor-ai/vinctor-core/blob/main/docs/threat-model.md)
in `vinctor-core`.

## Supported Versions

During the preview period only the latest released version is supported.

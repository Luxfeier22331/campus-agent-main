---
doc_type: context
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Context: Phase 6 Production Acceptance And Operator Runbook

## Problem

Phase 1-5 implemented the public docs rolling publish mechanics: manifest
validation, ledger, scheduled runner, single-flight lock, build/smoke/deploy
pipeline, retry/rollback and optional hook nudger.

The remaining requirement is to prove the workflow can be operated as a
long-running production process without relying on manual reasoning or real
Cloudflare side effects during local verification.

## Acceptance Scope

Phase 6 must capture machine-readable evidence for:

- prod dry-run changed manifest;
- staging dry-run changed manifest;
- unchanged manifest skip;
- changed manifest deploy through injected commands;
- invalid manifest blocking deploy;
- blocked manifest blocking deploy;
- active lock blocking deploy;
- command failure appending failed ledger;
- rollback dry-run planning;
- hook local pipeline nudge;
- hook Cloudflare Deploy Hook dispatch through injected `fetch`.

## Constraints

- Do not call real Cloudflare deploy, rollback or Deploy Hook URLs.
- Do not require real object storage credentials.
- Do not mutate tracked runtime state under `.planning/runtime/`.
- Keep acceptance evidence repeatable from repo root through `pnpm`.
- Keep `public-docs` as deploy runner tooling; Worker runtime still does not
  execute deploy.

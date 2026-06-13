---
doc_type: template
truth_scope: ops
owner_boundary: docs/runbooks/templates
status: active
created: 2026-06-03
updated: 2026-06-03
---
# E2E QA Release Evidence

## Run Metadata

- Environment: `staging`
- Target domain family: `mucwiki-edge.link`
- Evidence directory:
- Git branch:
- Git SHA:
- Release identity:
- Operator:
- Started at UTC:
- Finished at UTC:
- Final verdict: `pass` | `fail`

## Scope

- Included surfaces:
  - `api-staging.mucwiki-edge.link`
  - `hub-staging.mucwiki-edge.link`
  - `chat-staging.mucwiki-edge.link`
  - `docs-staging.mucwiki-edge.link`
  - `panel-staging.mucwiki-edge.link`
- Explicitly excluded:
  - `hub.muc.wiki` production custom-hostname path
  - `execution-control-staging.mucwiki-edge.link` as a public surface; it is only
    the trusted machine ingress used by `app-api`

## Repo Preflight

- `pnpm docs:lint`:
- `pnpm decomposition:lint`:
- `git diff --check`:
- Additional lanes if code changed:

## Staging Runtime Readiness

- `status-execution-control-staging.sh --check`:
- Qdrant runtime URL check:
- Docker data-plane check:
- Notes:

## Public Surface Health

- app-api health
  - URL: `https://api-staging.mucwiki-edge.link/healthz`
  - Result:
  - Evidence file:
- app-api ready
  - URL: `https://api-staging.mucwiki-edge.link/readyz`
  - Result:
  - Evidence file:
- hub health
  - URL: `https://hub-staging.mucwiki-edge.link/healthz`
  - Result:
  - Evidence file:
- hub ready
  - URL: `https://hub-staging.mucwiki-edge.link/readyz`
  - Result:
  - Evidence file:
- chat health
  - URL: `https://chat-staging.mucwiki-edge.link/healthz`
  - Result:
  - Evidence file:
- chat ready
  - URL: `https://chat-staging.mucwiki-edge.link/readyz`
  - Result:
  - Evidence file:
- docs ready
  - URL: `https://docs-staging.mucwiki-edge.link/readyz`
  - Result:
  - Evidence file:
- execution-control machine ingress
  - Public surface: `no`
  - Verified by: `status-execution-control-staging.sh --check`
  - App-api readyz dependency evidence:
  - Notes:

## Chat E2E Cases

- Default
  - Prompt: default script prompt
  - Result kind:
  - Request ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Curriculum
  - Prompt: 民族学本科人才培养方案总学分要求是多少？
  - Result kind:
  - Request ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Alias
  - Prompt: 校园网密码怎么改？
  - Result kind:
  - Request ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Student rule
  - Prompt: 中央民族大学本科学生国家奖学金评审办法
  - Result kind:
  - Request ID:
  - Trace ID:
  - Evidence file:
  - Verdict:

## Docs QA

- `docs:gated:smoke:staging`:
- Docs root:
- Docs readyz:
- Gated anonymous behavior:
- Gated authorized behavior:
- Reader asset locality check:

## Protected Panel QA

- `access:smoke:staging`:
- Access redirect without service token:
- Service-token `/healthz`:
- Service-token `/readyz`:
- Service-token `/api/overview`:
- Human operator browser check:

## Browser QA

- Hub
  - URL: `https://hub-staging.mucwiki-edge.link`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:
- Chat
  - URL: `https://chat-staging.mucwiki-edge.link`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:
- Docs
  - URL: `https://docs-staging.mucwiki-edge.link`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:
- Panel
  - URL: `https://panel-staging.mucwiki-edge.link`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:

## Observability

- Sentry lookup access:
- Sentry spans query:
- Sentry issue-list permission note:
- Axiom dataset: `campus-agent-runtime`
- Axiom query:
- Axiom matched events:
- Redaction check:

## Data Plane Sanity

- Remote container inventory:
- Qdrant aliases:
- Release manifest guard:
- Object storage / R2 boundary:
- Snapshot storage boundary:

## Findings

- `blocker`
  - Surface:
  - Description:
  - Evidence:
  - Owner:
  - Status:
- `non-blocking answer-quality badcase`
  - Surface:
  - Description:
  - Evidence:
  - Owner:
  - Status:
- `external credential/config blocker`
  - Surface:
  - Description:
  - Evidence:
  - Owner:
  - Status:
- `documentation drift`
  - Surface:
  - Description:
  - Evidence:
  - Owner:
  - Status:

## Closeout

- Final verdict:
- Blocking issues remaining:
- Non-blocking badcases recorded:
- Follow-up workstream / backlog links:
- Reviewer:
- Reviewed at UTC:

---
doc_type: template
truth_scope: ops
owner_boundary: docs/runbooks/templates
status: active
created: 2026-06-03
updated: 2026-06-09
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
  - `campus-staging.mucwiki-edge.link`
  - `campus-staging.mucwiki-edge.link`
  - `operator-console-staging.mucwiki-edge.link`
- Explicitly excluded:
  - `campus.muc.wiki` production custom-hostname path
  - `execution-control-staging.mucwiki-edge.link` as a public surface; it is only
    the trusted machine ingress used by `app-api`

## Repo Preflight

- `pnpm repo:static`:
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
- campus health
  - URL: `https://campus-staging.mucwiki-edge.link/healthz`
  - Result:
  - Evidence file:
- campus ready
  - URL: `https://campus-staging.mucwiki-edge.link/readyz`
  - Result:
  - Evidence file:
- chat health
  - URL: `https://campus-staging.mucwiki-edge.link/healthz`
  - Result:
  - Evidence file:
- chat ready
  - URL: `https://campus-staging.mucwiki-edge.link/readyz`
  - Result:
  - Evidence file:
- campus docs
  - URL: `https://campus-staging.mucwiki-edge.link/docs/`
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
  - Run ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Curriculum
  - Prompt: 民族学本科人才培养方案总学分要求是多少？
  - Result kind:
  - Request ID:
  - Run ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Alias
  - Prompt: 校园网密码怎么改？
  - Result kind:
  - Request ID:
  - Run ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Student rule
  - Prompt: 中央民族大学本科学生国家奖学金评审办法
  - Result kind:
  - Request ID:
  - Run ID:
  - Trace ID:
  - Evidence file:
  - Verdict:
- Durable reconnect
  - Evidence file: `chat-durable-reconnect.json`
  - Submit run ID:
  - Run request ID:
  - Run trace ID:
  - Temporal workflow ID:
  - Langfuse closeout product trace ID:
  - Langfuse closeout session ID:
  - Langfuse closeout user ID:
  - Verdict:

## Docs QA

- `docs:gated:smoke:staging`:
- Docs root:
- Docs readyz:
- Gated anonymous behavior:
- Gated authorized behavior:
- Reader asset locality check:

## Operator Console QA

- `access:smoke:staging`:
- Access redirect without service token:
- Service-token `/healthz`:
- Service-token `/readyz`:
- Service-token `/api/overview`:
- Human operator browser check:

## Browser QA

- Campus
  - URL: `https://campus-staging.mucwiki-edge.link`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:
- Chat
  - URL: `https://campus-staging.mucwiki-edge.link`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:
- Docs
  - URL: `https://campus-staging.mucwiki-edge.link/docs/`
  - Screenshot / evidence:
  - Console / network issues:
  - Verdict:
- Panel
  - URL: `https://operator-console-staging.mucwiki-edge.link`
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
- Langfuse trace evidence:
  - Release evidence JSON: `langfuse-release-evidence.json`
  - Product identity source: `chat-durable-reconnect.json.langfuseCloseout`
  - Checker command: see `runtime-otel-collector-pipeline.md`
  - Checker result:
  - Product trace ID:
  - Langfuse trace ID:
  - Session ID:
  - User ID:
  - Release:
  - Request ID:
  - Run ID:
  - Temporal workflow ID:
  - `verify-langfuse-trace` output:
- Langfuse eval score publish:
  - Profile report:
  - Score report:
  - `publish-langfuse-score-report` output:
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

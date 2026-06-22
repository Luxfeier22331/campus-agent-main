---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks/templates
status: active
created: 2026-04-02
updated: 2026-04-20
---
# Worker Observability Smoke Artifact Template

## 用途

这份模板用于 `docs/runbooks/worker-observability-smoke-runbook.md` 里的两类落盘动作：

- 本地 `Pre-Deploy Readiness` 复核
- 真实环境 `Post-Deploy Verification`

建议在每轮执行时新建：

- `.tmp/observability-smoke/<timestamp>-<environment>-<release>/SUMMARY.md`
- `.tmp/observability-smoke/<timestamp>-<environment>-<release>/chat-trace.md`
- `.tmp/observability-smoke/<timestamp>-<environment>-<release>/panel-trace.md`
- `.tmp/observability-smoke/<timestamp>-<environment>-<release>/app-api-runtime-
  event.md`

如果当前还没有真实部署环境，也照样落 `SUMMARY.md`，并把最终状态写成 `post-deploy verification pending`。

## `SUMMARY.md` 模板

```md
# Worker Observability Smoke Summary

- Timestamp:
- Scope: `pre-deploy-readiness` | `post-deploy-verification`
- Status: `ready` | `pending` | `failed`
- Branch / commit:
- Operator:

## Deployment Handoff

- Environment:
- `campus-web` hostname:
- `operator-console-web` hostname:
- `app-api` hostname:
- Worker release:
- `SENTRY_*` deployed: `yes` | `no`
- Collector `OTEL_COLLECTOR_AXIOM_*` deployed: `yes` | `no`
- Sentry access confirmed: `yes` | `no`
- `check_sentry_lookup_access --json`:
- Axiom access confirmed: `yes` | `no`
- Smoke identity / credentials source:

## Pre-Deploy Readiness

- `check_worker_observability_env --json`:
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose`:
- `pnpm --dir apps/campus-web test:worker -- --reporter=verbose -t
  "smokes a chat request through campus-web into app-api"`:
- `pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose -t
  "smokes request queries through operator-console-web into app-api with
  internal caller admission"`:

## Post-Deploy Verification

- `campus-web -> app-api`:
- `operator-console-web -> app-api`:
- `app-api` controlled error:
- `app-api` scheduled / projection drain:

## Evidence

- Sentry notes:
- `campus-web -> app-api` trace file:
- `operator-console-web -> app-api` trace file:
- `app-api` runtime event file:
- Trace IDs:

## Final Verdict

- `Pre-Deploy Readiness`:
- `Post-Deploy Verification`:
- Next unblocker:
```

## `chat-trace.md` 模板

```md
# Online Answer To App API Trace

## Run Metadata

- Timestamp:
- Environment:
- Worker release:

## Request

- Request path:
- HTTP status:
- `x-trace-id`:

## Trace Evidence

- `campus-web` event link / screenshot:
- `app-api` event link / screenshot:
- Shared trace observed:
- `surface=campus-web` observed:
- `surface=app_api` observed:

## Notes

-
```

## `panel-trace.md` 模板

```md
# Operator Console To App API Trace

## Run Metadata

- Timestamp:
- Environment:
- Worker release:

## Request

- Request path:
- HTTP status:
- `x-trace-id`:

## Trace Evidence

- `operator-console-web` event link / screenshot:
- `app-api` event link / screenshot:
- Shared trace observed:
- `surface=operator-console-web` observed:
- `surface=app_api` observed:

## Notes

- operator identity:
- route / query:
- Access envelope state:
```

## `app-api-runtime-event.md` 模板

```md
# App API Runtime Event

## Run Metadata

- Timestamp:
- Environment:
- Dataset:
- Worker release:

## Trigger

- Event type:
- Trigger path / scheduler:
- Time window:

## Evidence

- Axiom query / filter:
- Event link / screenshot:
- `event_type=projection.drain` or equivalent:
- `surface=app_api` or `surface=official_web`:
- `processed_count`:
- `failed_count`:

## Data Hygiene

- Raw prompt absent:
- Raw answer absent:
- Raw auth header absent:
- Raw transcript absent:

## Notes

-
```

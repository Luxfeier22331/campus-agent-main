---
doc_type: runbook
status: active
created: 2026-04-02
updated: 2026-04-02
---

# Worker Observability Smoke Artifact Template

## 用途

这份模板用于 `docs/runbooks/worker-observability-smoke-runbook.md` 里的两类落盘动作：

- 本地 `Pre-Deploy Readiness` 复核
- 真实环境 `Post-Deploy Verification`

建议在每轮执行时新建：

- `.tmp/observability-smoke/<timestamp>/SUMMARY.md`
- `.tmp/observability-smoke/<timestamp>/sentry-trace-notes.md`
- `.tmp/observability-smoke/<timestamp>/axiom-runtime-events.md`

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
- `public-chat-web` hostname:
- `protected-panel-web` hostname:
- `app-api` hostname:
- Worker release:
- `SENTRY_*` deployed: `yes` | `no`
- `AXIOM_*` deployed: `yes` | `no`
- Sentry access confirmed: `yes` | `no`
- Axiom access confirmed: `yes` | `no`
- Smoke identity / credentials source:

## Pre-Deploy Readiness

- `check_worker_observability_env --json`:
- `pnpm --dir apps/app-api test:worker -- --reporter=verbose`:
- `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"`:
- `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"`:

## Post-Deploy Verification

- `public-chat-web -> app-api`:
- `protected-panel-web -> app-api`:
- `app-api` controlled error:
- `app-api` scheduled / projection drain:

## Evidence

- Sentry notes:
- Axiom notes:
- Trace IDs:

## Final Verdict

- `Pre-Deploy Readiness`:
- `Post-Deploy Verification`:
- Next unblocker:
```

## `sentry-trace-notes.md` 模板

```md
# Sentry Trace Notes

## Run Metadata

- Timestamp:
- Environment:
- Worker release:

## Event Links / Screenshots

- `public-chat-web`:
- `protected-panel-web`:
- `app-api`:

## Trace Propagation Checks

- Shared trace observed:
- `surface=public-chat-web` observed:
- `surface=protected-panel-web` observed:
- `surface=app_api` observed:

## Error Hygiene

- Controlled error captured:
- Raw `cookie` absent:
- Raw `authorization` absent:
- Raw `prompt` absent:
- Raw `answer` absent:

## Notes

-
```

## `axiom-runtime-events.md` 模板

```md
# Axiom Runtime Events

## Run Metadata

- Timestamp:
- Environment:
- Dataset:
- Worker release:

## Query Inputs

- Query / filter:
- Time window:

## Expected Runtime Events

- `event_type=projection.drain`:
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

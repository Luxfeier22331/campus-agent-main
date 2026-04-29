---
doc_type: state
status: completed
created: 2026-04-27
updated: 2026-04-28
---

# State: Ingestion Worker Independent Deployment Hardening

## Current Status

- status: `completed`
- completed phase: `Phase 0-7`
- owner: unassigned
- active implementation: no
- target host: `ubuntu-43`
- target host hostname: `VM-0-2-ubuntu`

## Current Repo Facts

- `campus-ingestion-run-on-demand-batch --help` is available.
- `campus-ingestion-preflight --help` is available.
- `apps/ingestion-worker` documents on-demand bounded CLI execution as the default posture.
- `scripts/run-internal-notice-multimodal-drain.sh` exists.
- `infra/local/systemd/campus-ingestion-internal-notice.service` and `.timer` exist as minimal
  copyable templates.
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md` documents local dev, scheduling
  shape, failure handling, and resource report review.
- Current OCR path uses external MinerU API; it does not load local OCR / vision models.
- Current memory risk is bytes buffering and artifact accumulation:
  - object-store attachment reads are full `bytes`
  - MinerU upload/download path is bytes-backed
  - oversized PDF split accumulates segment / archive payloads
  - OCR provider response cache can retain provider bytes

## Captured Gaps

Tracked gaps now live in `REQUIREMENTS.md` as:

- `INGEST-RES-01` through `INGEST-RES-07`
- `INGEST-OPS-01` through `INGEST-OPS-10`

## Initial Assessment

The right completion path is ops hardening around the existing Python CLI posture, not a runtime
rewrite. Current expected volume does not justify a resident service or queue worker.

The highest-risk implementation path is authenticated notice closeout with OCR attachments. It
should receive resource policy and file-backed MinerU work before being placed on unattended
server scheduling.

## Planned Execution Order

1. `Phase 0`: baseline and corrected resource risk confirmation.
2. `Phase 1`: resource policy, cache bounds, and report metrics.
3. `Phase 2`: batch operator shell, lock, and retention.
4. `Phase 3`: file-backed object read and MinerU upload/download.
5. `Phase 4`: provider artifact references and oversized PDF segment persistence.
6. `Phase 5`: Docker image and local dev parity.
7. `Phase 6`: systemd hardening and alerting.
8. `Phase 7`: deployment acceptance smoke.

## Executed In This Iteration

- `Phase 0`: baseline correction landed (external MinerU API path, bytes lifecycle risk model).
- `Phase 1`: runner resource policy, cache bounds, and resource budget report fields landed.
- `Phase 2`: unified operator shell with preflight/lock/batch/retention landed.
- `Phase 3`: authenticated notice OCR path supports file-backed object download and file hashing.
- `Phase 4`: MinerU upload/download path now supports streamed transfer and reduced intermediate
  buffering; oversized PDF merge avoids canonical segment list accumulation.
- `Phase 5`: ingestion worker Dockerfile + docker entrypoint landed.
- `Phase 6`: hardened systemd templates landed for internal notice, official web,
  authenticated notice closeout, and wechat.

## Phase 7 Acceptance Outcomes

- Local lane evidence completed:
  - `campus-ingestion-run-on-demand-batch --help`
  - `campus-ingestion-preflight --help`
  - `campus-ingestion-preflight --live`
- Docker lane evidence completed:
  - ingestion worker image build (`apps/ingestion-worker/Dockerfile`)
  - container `help/static preflight`
- Server lane evidence completed on `ubuntu-43`:
  - `--live preflight` passed
  - writable small batches passed:
    - `internal-notice-multimodal-drain`
    - `official-web-handoffs`
  - systemd timer dry-run evidence captured
  - systemd timer real-run evidence captured
  - resource profile summary generated and recorded

## Verification Evidence

- remote artifact root:
  - `/home/ubuntu/campus-agent-ingestion-acceptance/artifacts/20260427T165723Z`
- local mirrored artifact root:
  - `.tmp/phase7-ingestion-acceptance/server/20260427T165723Z`
- key files:
  - `server-preflight-live.json`
  - `internal-notice-small-batch-report.json`
  - `official-web-small-batch-report.json`
  - `timer-dry-run-status.txt`
  - `timer-dry-run-list.txt`
  - `timer-real-run-report.json`
  - `timer-real-run-service-status.txt`
  - `timer-real-run-journal.txt`
  - `resource-profile-summary.json`
- resource profile summary:
  - `internal_small_batch.max_step_peak_rss_kb = 180248` (`within_budget`)
  - `official_web_small_batch.max_step_peak_rss_kb = 180172` (`within_budget`)
  - `timer_real_run.max_step_peak_rss_kb = 191568` (`within_budget`)

## Scope Guardrail Confirmation

Validated as out of scope in this workstream:

- long-running resident ingestion daemon
- data-plane canonical chain rewrite
- ingestion worker query-serving admission
- Go/Rust runtime migration

## Continuity Notes

- This workstream closes the independent deployment hardening gap for `apps/ingestion-worker`.
- Reopen only when:
  - new deployment substrate or runtime contract invalidates current acceptance evidence, or
  - resource profile evidence shows sustained budget breach requiring runtime migration.

## Verification Baseline

Use these after planning-only edits:

```bash
pnpm docs:lint
```

Use these after Phase 1 implementation:

```bash
uv run --package campus-ingestion-worker python -m unittest \
  tests.ingestion.test_deployment_preflight_worker \
  tests.test_ingestion_worker_on_demand_ops -q
uv run --all-packages ruff check \
  apps/ingestion-worker/src/campus_ingestion_worker/deployment_preflight.py \
  apps/ingestion-worker/src/campus_ingestion_worker/on_demand_batch_runner.py \
  tests/ingestion/test_deployment_preflight_worker.py \
  tests/test_ingestion_worker_on_demand_ops.py
uv run --all-packages ruff format \
  apps/ingestion-worker/src/campus_ingestion_worker/deployment_preflight.py \
  apps/ingestion-worker/src/campus_ingestion_worker/on_demand_batch_runner.py \
  tests/ingestion/test_deployment_preflight_worker.py \
  tests/test_ingestion_worker_on_demand_ops.py --check
pnpm docs:lint
```

## Continuity Notes

- Restore this workstream when server-side ingestion scheduling becomes imminent.
- Start with resource policy + report metrics before Docker/systemd work.
- Treat Go/Rust/TS migration as a separate decision only after report evidence shows Python process
  startup, memory, or execution time is the bottleneck.

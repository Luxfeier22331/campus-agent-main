---
doc_type: roadmap
status: completed
created: 2026-04-27
updated: 2026-04-28
---

# Roadmap: Ingestion Worker Independent Deployment Hardening

该 roadmap 对应的 phases 已全部完成并完成服务器侧验收闭环。

## Phase Status

- [x] Phase 0: Baseline And Resource Risk Confirmation
- [x] Phase 1: Resource Policy, Cache Bounds, And Report Metrics
- [x] Phase 2: Batch Operator Shell, Lock, And Retention
- [x] Phase 3: File-Backed Object Read And MinerU Upload / Download
- [x] Phase 4: Provider Artifact References And Oversized PDF Segment Persistence
- [x] Phase 5: Docker Image And Local Dev Parity
- [x] Phase 6: Systemd Hardening And Alerting
- [x] Phase 7: Deployment Acceptance Smoke

## Final Acceptance Evidence

- remote artifacts:
  - `/home/ubuntu/campus-agent-ingestion-acceptance/artifacts/20260427T165723Z`
- local mirror:
  - `.tmp/phase7-ingestion-acceptance/server/20260427T165723Z`
- phase 7 completion signals:
  - local help/static/live preflight passed
  - Docker help/static preflight passed
  - server live preflight passed
  - writable small batches (`internal-notice`, `official-web`) passed
  - timer dry-run + real-run evidence captured
  - resource profile summary recorded (`within_budget`)

## Phase 0: Baseline And Resource Risk Confirmation

**Goal:** 固定当前真实风险模型，避免把外部 MinerU API 路径误规划成本机 OCR 模型优化。

**Inputs:**

- `apps/ingestion-worker/README.md`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion_online_ocr.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections_engine.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_multimodal_processing.py`

**Scope:**

- 记录 MinerU API 主路径的 bytes buffering 点。
- 区分 notice OCR 主路径与课程地图 / service navigation 的专用 PDF render 路径。
- 梳理当前 on-demand runner、preflight、existing scripts、systemd template 的已完成与缺口。
- 固定初始资源预算：`1 CPU`、`768m` memory cap、首轮 peak RSS 目标 `<=512 MiB`。

**Deliverables:**

- workstream `STATE.md` 更新 baseline。
- runbook 增补 corrected resource-risk note。

**Verification:**

```bash
pnpm docs:lint
```

**Exit Criteria:**

- 规划文档不再声称 notice OCR 主路径存在本机模型加载。
- 每个后续 phase 都能追溯到 `INGEST-RES-*` 或 `INGEST-OPS-*` gap。

## Phase 1: Resource Policy, Cache Bounds, And Report Metrics

**Goal:** 先用资源闸门降低同机部署风险，不等待完整 streaming rewrite。

**Scope:**

- 为 on-demand runner 增加 worker resource policy：
  - max attachment bytes
  - max OCR input bytes
  - max batch items
  - max provider response cache bytes / entries
  - default attachment / OCR concurrency = `1`
- authenticated notice closeout 默认禁用或严格限制 OCR provider response cache。
- report schema 增加：
  - resource policy snapshot
  - max input bytes
  - max provider archive bytes
  - OCR file count
  - cache hit / miss / skipped bytes
  - skipped item reason
  - peak RSS threshold verdict
- preflight 检查 resource policy shape。

**Primary Write Set:**

- `apps/ingestion-worker/src/campus_ingestion_worker/on_demand_batch_runner.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/deployment_preflight.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_replay.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections_engine.py`
- `tests/ingestion/`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`

**Verification:**

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

**Exit Criteria:**

- Low-volume defaults are conservative without requiring code operators to remember flags.
- A report can explain why a batch stayed within or exceeded memory budget.
- Cache cannot retain unbounded provider response bytes.

## Phase 2: Batch Operator Shell, Lock, And Retention

**Goal:** 把 local dev 与 future server execution 收口到同一个 repeatable batch shell。

**Scope:**

- 增加统一 operator script：
  - run preflight
  - acquire lock
  - run selected batch
  - write report
  - run retention
  - release lock
- 为 batch overlap 定义行为：
  - default: skip with explicit report / exit code
  - operator override: fail fast
- 补 admitted batch kinds 的 scripts：
  - `internal-notice-multimodal-drain`
  - `official-web-handoffs`
  - `authenticated-notice-closeout`
  - `wechat-public-notices` explicit operator-run only
- 增加 report retention command：
  - max age
  - max count
  - keep failed reports
  - write failed index

**Primary Write Set:**

- `scripts/run-ingestion-worker-batch.sh` or `apps/ingestion-worker/src/...` CLI wrapper
- `scripts/run-internal-notice-multimodal-drain.sh`
- new per-batch scripts under `scripts/`
- `apps/ingestion-worker/src/campus_ingestion_worker/report_retention.py`
- `apps/ingestion-worker/pyproject.toml`
- `tests/ingestion/`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`

**Verification:**

```bash
uv run --package campus-ingestion-worker campus-ingestion-preflight \
  --batch-kind internal-notice-multimodal-drain \
  --report-dir .tmp/ingestion-reports \
  --lock-dir .tmp/ingestion-locks
uv run --package campus-ingestion-worker campus-ingestion-run-on-demand-batch --help
uv run --package campus-ingestion-worker python -m unittest \
  tests.test_ingestion_worker_on_demand_ops -q
pnpm docs:lint
```

**Exit Criteria:**

- Operator does not need to hand-compose preflight / lock / batch / retention commands.
- Overlap produces a deterministic report or deterministic skip.
- Report cleanup is reproducible and preserves failed evidence.

## Phase 3: File-Backed Object Read And MinerU Upload / Download

**Goal:** 移除 notice attachment OCR 主路径中最高风险的 long-lived full bytes buffers。

**Scope:**

- 在 ingestion boundary 增加 file-backed object read abstraction，不泄漏 S3 / MinIO concrete type
  到 contracts。
- authenticated notice attachment 路径优先迁移：
  - object store download to temp file
  - hash while streaming or via bounded file read
  - text extraction / layout builder 保留小文件兼容 path
- MinerU client 支持:
  - parse file without duplicate `read_bytes()`
  - upload file handle / stream
  - stream archive response to temp file
  - only read back small archive when downstream still requires bytes
- 添加 temp dir lifecycle 与 cleanup guarantee。

**Primary Write Set:**

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion_online_ocr.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections_engine.py`
- object store protocol definitions local to ingestion packages
- `apps/ingestion-worker/src/campus_ingestion_worker/deployment_preflight.py`
- `tests/ingestion/`

**Verification:**

```bash
uv run --all-packages python -m unittest discover -s tests -t .
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
```

**Exit Criteria:**

- Main MinerU path does not read the same PDF into memory multiple times.
- Large provider archives can be streamed to file.
- Temp files are deleted on success and failure.

## Phase 4: Provider Artifact References And Oversized PDF Segment Persistence

**Goal:** 让大 OCR archive 与 oversized PDF segment 不再被 result objects 强制持有。

**Scope:**

- 设计 provider result 的 artifact reference extension：
  - object key reference
  - temp file reference for same-process handoff
  - bytes fallback for small artifacts
- oversized PDF flow:
  - split one segment
  - upload to MinerU
  - persist raw archive
  - emit canonical segment
  - release segment bytes
  - merge canonical outputs at the end
- 保持 canonical data-plane semantics 不变；只改变 payload transport / memory ownership。

**Primary Write Set:**

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion_online_ocr.py`
- authenticated notice OCR artifact builder modules
- document import input handling where provider response references are already supported or need extension
- tests covering small bytes fallback and large reference path

**Verification:**

```bash
uv run --all-packages python -m unittest discover -s tests -t .
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
```

**Exit Criteria:**

- Peak memory for oversized PDF is bounded by current segment plus merge output, not all segment archives.
- Downstream import still receives equivalent canonical artifacts.
- Artifact references do not leak infrastructure concrete types into `packages/contracts`.

## Phase 5: Docker Image And Local Dev Parity

**Goal:** 交付 Docker-first worker artifact，同时保留本地 dev 入口。

**Scope:**

- 添加 ingestion worker Dockerfile 或 repo-level Docker build target。
- Docker entrypoint 调用 unified operator shell。
- 容器默认：
  - non-root user
  - writable tmp mount
  - writable report mount
  - optional env file
  - read-only root fs where practical
  - no resident daemon mode
- 文档提供:
  - local dev command
  - docker run command
  - compose/server example
  - memory/cpu cap example
- 不把 domain-specific DB overrides 写回 root `.env.example`。

**Primary Write Set:**

- `apps/ingestion-worker/Dockerfile` or repo Dockerfile lane
- `scripts/`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`
- Docker lint/test wiring if repo convention requires it

**Verification:**

```bash
pnpm yaml:lint
pnpm docs:lint
uv run --package campus-ingestion-worker campus-ingestion-preflight --help
```

If Docker is available:

```bash
docker build -f apps/ingestion-worker/Dockerfile .
```

**Exit Criteria:**

- Same batch kind can be invoked locally and in Docker with the same logical args.
- Docker docs include resource caps and mount contract.
- No root `.env.example` pollution.

## Phase 6: Systemd Hardening And Alerting

**Goal:** 让同机部署不会因为 batch 异常拖垮 supervisor-api 或宿主机。

**Scope:**

- systemd timer/service templates for Docker-trigger lane or local CLI lane:
  - `Type=oneshot`
  - dedicated user
  - `EnvironmentFile`
  - `WorkingDirectory`
  - `TimeoutStartSec`
  - `MemoryMax`
  - `CPUQuota`
  - `NoNewPrivileges`
  - `PrivateTmp`
  - `ProtectSystem=strict`
  - `ProtectHome=true`
  - limited writable paths for report / lock / tmp
- alert path:
  - failed report marker
  - journal tag
  - optional webhook
  - documented manual recovery
- secret matrix lives in runbook / env inventory, not root `.env.example`。

**Primary Write Set:**

- `infra/local/systemd/`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`
- optional alert helper under `apps/ingestion-worker/src/`

**Verification:**

```bash
pnpm docs:lint
pnpm yaml:lint
```

**Exit Criteria:**

- systemd template has explicit hardening and writable-path contract.
- Failed batch creates visible evidence without requiring operator to parse full logs.
- Same server can run supervisor-api and ingestion batch with separate resource limits.

## Phase 7: Deployment Acceptance Smoke

**Goal:** 给 independent deployment 一个可重复的 release gate。

**Scope:**

- local help / static preflight
- Docker help / static preflight
- server live preflight
- writable small batch:
  - `internal-notice-multimodal-drain --limit 1 --batch-size 1 --max-attempts 1 --skip-read-model-rebuild`
  - `official-web-handoffs --limit 1` dry or staged mode
  - authenticated notice closeout small run only after fixture / export bundle is available
- scheduled timer dry-run
- scheduled timer real run
- resource profile review

**Verification:**

```bash
uv run --package campus-ingestion-worker campus-ingestion-preflight \
  --batch-kind internal-notice-multimodal-drain \
  --report-dir .tmp/ingestion-reports \
  --lock-dir .tmp/ingestion-locks
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  internal-notice-multimodal-drain \
  --limit 1 \
  --batch-size 1 \
  --max-attempts 1 \
  --skip-read-model-rebuild \
  --report-path .tmp/ingestion-reports/internal-notice-multimodal-local-smoke.json
```

**Exit Criteria:**

- Reports show success or intentional skip with no unclassified failure.
- Peak RSS is recorded and under the accepted budget or explicitly waived.
- Operator can replay / repair from report evidence.

## Dependency Order

- Phase 0 must complete before implementation.
- Phase 1 can run before Docker and should be first implementation slice.
- Phase 2 can run in parallel with Phase 1 only if write sets are separated; otherwise do Phase 1 first.
- Phase 3 depends on Phase 1 resource reporting so memory improvements can be measured.
- Phase 4 depends on Phase 3 unless a smaller artifact-reference design is isolated first.
- Phase 5 depends on Phase 2 for stable entrypoint shape.
- Phase 6 depends on Phase 5 if the chosen production lane is Docker-triggered systemd.
- Phase 7 is final acceptance and should not introduce new behavior.

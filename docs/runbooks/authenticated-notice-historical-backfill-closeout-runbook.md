---
doc_type: runbook
status: historical
created: 2026-04-04
updated: 2026-04-12
---

# Authenticated Notice Historical Backfill Closeout Runbook

## 文档边界

这份 runbook 只描述 legacy cumulative-prefix authenticated notice historical closeout workflow。

它不替代：

- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md` 的 bounded smoke 说明
- `docs/runbooks/authenticated-notice-async-staged-closeout-runbook.md` 的 canonical async staged closeout
- live collector runbook
- control-plane/operator runbook

当前补充说明：

- 这份 runbook 已不再对应一个待执行的默认 closeout lane
- repo 当前真实 closeout truth 以 `authenticated-notice-replay-20260406-024405` 和后续 local-Postgres current-scope 链路为准
- 如无明确历史对照需求，不应再默认重跑这条 legacy cumulative-prefix runner

## 适用前提

- 已存在 historical export bundle 和 manifest
- object store / raw asset registry / document registry 已配置
- 当前目标仍是 `campus_notices/internal_notice`
- collection posture 仍是 `restricted + offline_preparation`

## Canonical Closeout 命令

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.closeout_authenticated_notice_historical_backfill \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --output-dir .tmp/authenticated-notice-closeout/20260404T000000-run-14 \
  --checkpoint-size 240 \
  --checkpoint-size 1000 \
  --checkpoint-size 3000 \
  --final-rerun
```

说明：

- 如果不显式传 `--checkpoint-size`，runner 默认会用 `240 -> 1000 -> 3000 -> full`
- runner 会把 full bundle count 自动视为最终 checkpoint
- `--final-rerun` 会在 full replay 完成后再次运行 full import
- `--skip-existing` 可用于续跑已经有 `summary.json` 的 checkpoint
- checkpoint 只能使用 cumulative prefix slices；不要把 disjoint shards 当成 staged replay 输入，因为 authenticated notice import 会 `scope_refresh` 整个 collection
- runner 会把最终 `closeout-summary.json` 打到 `stdout`
- runner 会把 `closeout_started / checkpoint_started / checkpoint_heartbeat / checkpoint_finished / final_rerun_* / closeout_finished` 这类实时事件打到 `stderr`
- 如果你是在交互终端里执行，就应该能实时看到 heartbeat；如果当前进程是在补丁之前启动的旧 runner，它不会自动获得这组日志，除非重启该次执行

## 输出物

输出目录至少包含：

- `frozen-input.json`
- `checkpoint-0240/summary.json`
- `checkpoint-1000/summary.json`
- `checkpoint-3000/summary.json`
- `checkpoint-6694/summary.json` 或 full-count 对应目录
- `final-rerun/summary.json`（如果启用）
- `closeout-summary.json`

## `frozen-input.json` 应包含什么

- bundle path
- manifest path
- manifest/export scope
- expected notice count
- chosen checkpoints
- site / corpus / collection / visibility baseline

## 通过标准

closeout 通过至少要求：

- 每个 checkpoint summary 的 `ok=true`
- final rerun summary 的 `ok=true`（如果启用）
- `closeout-summary.json` 中：
  - `missing_document_id_count=0`
  - `missing_raw_asset_id_count=0`
  - `unexpected_document_id_count=0`
  - `missing_document_units_count=0`
  - `missing_notice_manifest_count=0`

额外说明：

- `unexpected_raw_asset_id_count` 是观测项，不是默认 fail gate
- 原因不是放宽标准，而是 authenticated notice import 只对 document scope 做 `scope_refresh`；raw asset registry 会保留同 scope 的历史记录
- 因此 raw reconciliation 的 closeout 语义是 expected coverage，而不是 exact scope equality

## 失败时先看什么

1. `frozen-input.json`
   - 是否跑错 bundle / manifest
2. checkpoint summary
   - 哪个 checkpoint 首次失败
   - `errors` 是否非空
3. `closeout-summary.json`
   - 是 import 失败，还是 reconciliation 未闭合
   - 如果只有 `unexpected_raw_asset_id_count` 非零，先确认是否只是已有 scope 历史 raw rows；这本身不表示 closeout 失败
4. 如果再次出现 object-store stall
   - 先确认 zero-byte one-shot client 保护仍在
   - 不要通过篡改 empty artifact 语义来“规避”问题

## Async staged observability (Phase 12.2)

- Phase 12.2 shifts historical closeout into an async staged pipeline rooted at `campus_notices/operations/authenticated-notice-closeout/{run_id}/`. Operators will find `run-manifest.json`, `shard-plan.json`, checkpoint fusions, `heartbeat/{shard_id}.json`, `milestones/*.json`, and `reconciliation/closeout-summary.json` there as the single source of progress truth.
- The ingestion-worker CLI will surface the `closeout_runs` / `closeout_shards` rows plus `closeout_notice_stage`, `closeout_raw_asset_stage`, and `closeout_document_stage` entries for each run so you can inspect per-run counts and digests without re-running checkpoints. Each shard writes to these staging tables; only the single promoter reads them, validates counts/digests, copies artifacts into `campus_notices/documents/internal_notice/...`, calls `replace_scope`, and writes `closeout_promotions` plus the reconciliation digest.
- Verification now compares staged notice/raw/document hashes and asset coverage counts before promotion; the object-store layout and staging table schema guarantee the CLI, operator dashboards, and future automation always see the same deterministic state even if shards crash and restart.

## 与 Phase 12 的关系

- Phase 12 证明了 bounded replay through `240`
- 这份 runbook 负责从 bounded replay 进入 full historical closeout
- 它不表示 phase 已经自动完成；真正的 closeout 以本次输出目录中的 evidence 为准
- Phase 12.2 之后，canonical 前向 closeout 路径已经切到 async staged runner；本 runbook 只保留给旧 runner 或历史对照

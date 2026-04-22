---
doc_type: runbook
status: active
created: 2026-04-05
updated: 2026-04-20
---
# Authenticated Notice Source-Truth Replay Runbook

## 文档边界

这份 runbook 只描述 authenticated notice historical source-truth 的 canonical replay /
preparation operator path。

它负责：

- bounded pilot 与 full replay 的执行顺序
- inventory rebuild、run planning、worker execution 与 repair
- promote / release 之前的 operator stop point

它不负责：

- collection-specific lane strategy
- auth-window live collector
- target-side regulation materialization

相关文档：

- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
- `docs/runbooks/authenticated-notice-async-staged-closeout-runbook.md`

## Canonical Execution Model

authenticated notice historical replay 固定按以下顺序推进：

1. source projection / routing 变更时，先做 bounded pilot
1. full replay planning 前，先重建 source-truth inventory
1. replay -> staged validation -> chunk preparation -> preparation validation
1. verified preparation 之后，如需继续 release，下一步固定是 `release_registry_scope
   - -no-publish-alias`

固定 operator 规则：

- 必须显式设置 `OCR_PROVIDER_MODE`
- 不依赖 `OCR_BASE_URL` 推断 provider
- verified preparation 不是自动 release 许可

## When To Run A Bounded Pilot

出现以下变化时，默认先做 bounded pilot：

- source projection 调整
- attachment routing 调整
- manual-review routing 调整
- OCR provider contract 变化

pilot 固定要求：

- 只覆盖小批量 notice
- 第一次执行只开 `1` 个 worker
- 先证明 replay truth、attachment outcome、staged rows 与 object artifacts 正确
- pilot 通过前，不继续 promote、release、embedding 或 alias publish

## Step 1: Rebuild Scoped Inventory

pilot 或 targeted replay 前，先重建 scoped inventory：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id_1> \
  --notice-id <notice_id_2>
```

固定要求：

- selected notice 固定从 source-truth inventory 选择
- 不从 collector 文件系统或临时 bundle 手选 notice 作为长期 truth

## Step 2: Plan Replay Run

bounded pilot：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.plan_authenticated_notice_source_truth_replay
  --run-id authenticated-notice-source-truth-pilot-<yyyymmdd-hhmmss> \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id_1> \
  --notice-id <notice_id_2> \
  --shard-size 8 \
  --batch-size 4 \
  --max-concurrency 1 \
  --notice-concurrency 2 \
  --object-store-concurrency 8 \
  --lease-seconds 300
```

固定要求：

- pilot 优先小 shard、小 batch、低并发
- full replay 也必须基于 rebuilt inventory planning

## Step 3: Run Worker

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.run_authenticated_notice_closeout_worker
  --run-id <run_id> \
  --worker-id <worker_id>
```

pilot 默认先单 worker。

## Step 4: Validate Pilot / Replay

bounded pilot 至少确认：

- run `state = verified`
- `selected_notice_ids` 与 scoped inventory 一致
- staged rows 只覆盖 selected notices
- `ocr_required` / `manual_review_required` / `reference_only` outcome 全部明确
- sample attachment artifacts 可回审：
  - `provider-response.jsonl`
  - `layout-elements.jsonl`
  - `canonical.md`
  - `document-units.jsonl`

## Step 5: Stop Point Before Release

verified chunk preparation 之后，固定 stop point 为：

- 可以继续 target-side validation
- 可以继续 `release_registry_scope --no-publish-alias`
- 不直接 publish alias

如果当前项目阶段未授权继续 release，则停在 verified / preparation validation。

## Source Object Completeness Repair

如果 replay attachment child document 时出现 `NoSuchKey`，优先按 source bucket
completeness 缺失处理，而不是当成 replay 重试问题。

repo-owned repair 入口：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.backfill_authenticated_notice_attachment_objects
  --bundle-path /path/to/notices-bundle.json \
  --blob-root /path/to/blob-store \
  --max-concurrency 8
```

可选精确回填：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.backfill_authenticated_notice_attachment_objects
  --bundle-path /path/to/notices-bundle.json \
  --blob-root /path/to/blob-store \
  --notice-id <notice_id_1> \
  --notice-id <notice_id_2> \
  --max-concurrency 8
```

固定要求：

- 不把 collector `local_path` 提升成长期 contract
- 回填后修复同一个 run，不新开 delta run

## OCR Failure Triage

OCR triage 固定顺序：

1. 先确认 attachment 是否本来就应进入 `ocr_required`
1. 再检查图片内容与 notice 上下文
1. 只有在线性文本 / 表格 OCR candidate 已确认成立时，才把 provider 结果缺失认定为 provider breach

固定禁止：

- 因单个坏图直接改写整条 replay 主路径
- 未看图片与上下文就先把 provider 当第一嫌疑

## Handoff Rule

pilot 的旧独立 runbook 现在只保留历史对照。 当前默认 operator 入口始终以本文为准。

---
doc_type: runbook
status: active
created: 2026-04-06
updated: 2026-04-12
---

# Authenticated Notice Source-Truth Replay Pilot Runbook

## 文档边界

这份 runbook 描述 authenticated notice source-truth replay 的 bounded pilot：

- 输入固定为 repo-owned authenticated notice `source-truth`
- 只跑小批量 `source-truth replay`
- 试点停在 `verified`
- 不继续 promote
- 不继续 chunk / release
- 不触发 embedding / Qdrant

它不替代：

- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的长期链路边界
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的 preparation strategy
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 的 chunk 质量验收

## Pilot 执行约束

pilot 运行固定采用以下约束：

- 先做 bounded pilot
- pilot 验收通过后，再决定是否扩到更大批次
- 在 pilot 验收完成前，不继续全量 replay
- 在 pilot 验收完成前，不继续 chunk / release / embedding
- pilot 环境必须显式设置 `OCR_PROVIDER_MODE=paddleocr_async_jobs`，不依赖 `OCR_BASE_URL` 推断 provider

这不是 fallback。对 replay truth、附件 outcome 和 staged rows 的正确性，pilot-first 是 canonical 前置关口。

## Pilot 样本要求

一轮有效 pilot 至少覆盖以下 notice 类型：

- `parent-only / clean body`
- `body_with_reference_only_attachments`
- 含 `text_extractable` attachment 的 notice
- 含 `ocr_required -> materialized_document` attachment 的 notice
- 含 `ocr_required -> no_extractable_text` attachment 的 notice
- 含 `manual_review_required` attachment 的 notice
- 含 `reference_only` attachment 的 notice

如果 scoped inventory 已经给出 notice risk profile，优先再补：

- `body_with_spatial_attachments`
- `mixed_high_risk`

建议样本规模：

- `5-12` notices

不要一开始就拉大批量；pilot 的目标是证明 typed replay truth、附件 outcome、stage rows 和 object artifacts 都正确，而不是先追求吞吐。

## 从 Inventory 选择 Pilot Notice

pilot notice 固定从 `ingestion_projection.authenticated_notice_source_truth_inventory` 选择，不从 collector 文件系统临时挑选。

推荐先查询 inventory typed columns：

```sql
select
  notice_id,
  attachment_document_count,
  text_extractable_count,
  ocr_required_count,
  coalesce((record->>'manual_review_required_count')::int, 0) as manual_review_required_count,
  reference_only_count,
  planning_weight
from ingestion_projection.authenticated_notice_source_truth_inventory
where corpus = 'campus_notices'
  and collection = 'internal_notice'
order by planning_weight desc, notice_id asc;
```

建议按下列规则组样本：

- `attachment_document_count = 0` 且 `ocr_required_count = 0`：clean parent-only
- `text_extractable_count > 0`：当前主要覆盖 native `docx` attachment
- `ocr_required_count > 0`：OCR candidate，包括 policy / handbook `pdf` 与 text-dominant image
- `manual_review_required_count > 0`：空间导览图 / 位置图样本
- `reference_only_count > 0`：reference-only attachment

如需确认某个 OCR notice 在历史 replay 中是否曾出现 `no_extractable_text`，允许对旧 run 的 staged truth 做只读查询；旧 run 只作为诊断证据，不作为新的 canonical run。

## 重建 Scoped Inventory

pilot 前先用 selected notice ids 重建一次 scoped inventory：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id_1> \
  --notice-id <notice_id_2> \
  --notice-id <notice_id_3>
```

固定要求：

- `--notice-id` 可重复传入
- inventory 必须 fast-fail missing notice ids
- 对 shared inventory store，这一步只允许 refresh selected rows，不允许把整张 scope inventory 缩成 pilot 子集
- 输出里的 `selected_notice_ids` 必须与 operator 预期完全一致

## 规划 Pilot Run

新建一个独立 pilot run，不复用旧全量 run：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.plan_authenticated_notice_source_truth_replay \
  --run-id authenticated-notice-source-truth-pilot-<yyyymmdd-hhmmss> \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id <notice_id_1> \
  --notice-id <notice_id_2> \
  --notice-id <notice_id_3> \
  --shard-size 8 \
  --batch-size 4 \
  --max-concurrency 1 \
  --notice-concurrency 2 \
  --object-store-concurrency 8 \
  --lease-seconds 300
```

固定要求：

- pilot 第一次执行只开 `1` 个 worker
- 先证明 correctness，再考虑增加 worker
- `show` 输出里的 `selected_notice_ids`、`expected_*` 计数必须与 scoped inventory 对齐

## 执行 Pilot Worker

pilot worker 固定先单 worker 执行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.run_authenticated_notice_closeout_worker \
  --run-id authenticated-notice-source-truth-pilot-<yyyymmdd-hhmmss> \
  --worker-id pilot-worker-01
```

执行中允许使用：

- `show_authenticated_notice_closeout`
- `watch_authenticated_notice_closeout`

但它们只用于读状态，不作为 correctness 证据本身。

## OCR Provider 契约异常处理

对 `ocr_required` attachment，pilot 固定执行以下判定：

- canonical provider 路径应指向可用的 PaddleOCR-VL async jobs endpoint
- 对规章制度 / 手册类 `pdf`，默认也按 `ocr_required` 处理，不把 native PDF extraction 当作 canonical fallback
- 如果 async OCR 失败，先检查 attachment 真实图片内容，并结合 notice 正文上下文判断它是否本来就应该进入 `ocr_required`
- 对二维码、示例证书、宣传海报、正文已完整说明的小程序教程截图，应先修 projection routing 到 `reference_only` 或 `manual_review_required`
- 只有在 attachment 已确认属于有效 OCR candidate 时，`state=done` 但 `resultUrl.jsonUrl` 在短 grace window 内持续 `404 NoSuchKey`，才视为 provider contract breach，而不是“继续长等”或“直接切同步”

这里的 operator 语义固定为：

- 必须记录 `notice_id`、`attachment_ref_id`、`job_id`、`jsonUrl`
- 必须把这类失败收敛为 replay blocker
- 不得因为 provider 结果对象缺失而继续 promote / chunk / embedding

这不是 fallback。`done -> resultUrl 可读` 是 replay correctness 的前置条件；如果上游 OCR provider 违约，本轮 run 应快速失败并留证。

## 必做验收

pilot 完成后，必须同时验以下几类 truth：

- run summary
- staged notice/raw/document rows
- attachment outcome truth
- object-store artifacts
- 数据库事务健康

### 1. Run Summary

必须确认：

- `state = verified`
- `selected_notice_ids` 与计划一致
- `expected_notice_count`、`expected_document_count`、`expected_attachment_document_count`、`expected_ocr_candidate_count` 合理
- `failure_reason` 为空

### 2. Staged Truth

必须确认：

- staged notice rows 只覆盖 selected notice ids
- parent notice documents 存在
- `text_extractable` attachment child documents 存在
- `ocr_required` attachment 都有确定 outcome
- `manual_review_required` attachment 都有显式 outcome，且不生成 child document
- `no_extractable_text` 不会伪造 child document

### 3. Attachment Artifacts

对样本 notice，至少抽查：

- `provider-response.jsonl`
- `layout-elements.jsonl`（仅 OCR materialized lane）
- `canonical-markdown.md`
- `document-units.jsonl`

### 4. 数据库事务健康

必须确认：

- 没有新的 `idle in transaction`
- 没有卡死的 replay worker backend
- worker 结束后，closeout run 不残留异常 running batch

## 明确禁止

pilot 阶段固定禁止：

- 复用旧全量 run 继续推进
- 一边试点一边继续全量 replay
- 在未验收前执行 `promote_authenticated_notice_closeout`
- 在未验收前继续 `prepare_registry_scope_chunks`
- 在未验收前继续 embedding / Qdrant / alias publish

## Pilot 收口产物

一轮 pilot 完成后，必须至少留存：

- pilot run id
- selected notice ids
- run summary
- staged truth 抽样结论
- attachment artifact 抽样结论
- transaction health 结论

只有这些证据齐全，才允许决定下一步是：

- 扩大 pilot 范围
- 继续全量 source-truth replay
- 或先修 replay 实现缺口

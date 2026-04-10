---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-10
---

# Internal Notice Offline Preparation Quality Evidence

## 文档边界

本文记录 `campus_notices/internal_notice` 的三次真实离线质量验收证据：

- 2026-04-06 的 current-scope 失败证据
- 2026-04-09 的 verified replay pilot staged 通过证据
- 2026-04-10 的 local Postgres full current-scope replay + preparation 通过证据

它回答的是：

- 当前 repo-owned `internal_notice` scope 是否已经通过 preparation quality acceptance
- 当前失败主要集中在哪些 lane 和失败类型
- 哪些问题是结构性 blocker，哪些问题只是观察指标

它不替代：

- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 的验收标准
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的 lane strategy

## 2026-04-09 Replay Pilot

### 正式 CLI Evidence

2026-04-09 这条 pilot 已经从 ad-hoc staged scan 收口到 repo-supported 正式链路：

- direct staged quality scan：
  - `run_id=authenticated-notice-source-truth-pilot-20260409-stratified-003`
  - `selection_mode=verified_closeout_run`
  - `sample_dir=/tmp/internal_notice_chunk_samples_authenticated_notice_source_truth_pilot_20260409_stratified_003_closeout_formal`
- closeout-backed preparation：
  - `preparation_run_id=prep-20260409-025125-closeout-003`
  - `selection_mode=verified_closeout_run`
  - `manifest_object_key=campus_notices/operations/registry-scope-chunk-preparation/prep-20260409-025125-closeout-003/internal_notice/chunk-preparation.json`
- canonical prep-manifest validation：
  - `selection_mode=preparation_manifest`
  - `closeout_run_id=authenticated-notice-source-truth-pilot-20260409-stratified-003`
  - `sample_dir=/tmp/internal_notice_chunk_samples_prep_20260409_025125_closeout_003`

这三次结果当前一致：

- `passed=true`
- `validated_document_count=20`
- `total_chunks=102`
- `header_dominant_ocr_chunk_count=0`
- `noisy_ocr_chunk_count=0`
- `markup_leak_chunk_count=0`

### 执行方式

本次验收消费的是 verified replay pilot：

- `run_id=authenticated-notice-source-truth-pilot-20260409-stratified-003`
- `selection_scope=9 notices / 20 staged documents`
- `sample_dir=/tmp/internal_notice_chunk_samples_20260409_stratified_003_staged_quality`

因为这批 pilot truth 还没有 promote 到 current scope，也没有 canonical `preparation_run_id`，所以本次采用的是：

- 基于 verified closeout staged `document-units.jsonl` 的只读 quality scan
- in-memory pilot registry 只映射这 20 份 staged child/parent documents
- 不向 current registry scope、derived final truth、embedding provider 或 Qdrant 写入任何数据

这次 staged 验收只回答：

- 当前 replay pilot 的 parent / attachment lane quality 是否可接受

它不回答：

- current scope 是否已经拿到 canonical `verified chunk preparation`
- 后续 release gate 是否已经具备 `preparation_run_id`

### Verdict

本次 replay pilot staged evidence 固定为：

- `passed`

因此对这批 frozen replay subset，可以写成：

- `pilot staged chunk quality accepted`

不能写成：

- `current scope canonical preparation accepted`
- `可以直接进入 release_registry_scope`

### Summary

machine-readable summary：

- `registry_record_count=20`
- `selected_record_count=20`
- `validated_document_count=20`
- `total_units=331`
- `total_chunks=102`

lane 分布：

- `notice_body`: `9` docs / `78` chunks
- `attachment_ocr_required`: `10` docs / `21` chunks
- `attachment_text_extractable`: `1` doc / `3` chunks

关键通过指标：

- `missing_title_chunk_count=0`
- `missing_contextualization_count=0`
- `missing_lane_metadata_count=0`
- `missing_attachment_lineage_count=0`
- `attachment_without_body_count=0`
- `markup_leak_chunk_count=0`
- `replacement_character_chunk_count=0`
- `header_dominant_ocr_chunk_count=0`
- `noisy_ocr_chunk_count=0`

### Remediation That Unblocked The Pilot

2026-04-09 这次 pilot 通过，依赖两类实现修复：

- manifest-based validator 不再先全量扫描 `internal_notice` current scope；显式 `preparation_run_id` 现在直接按 manifest 取记录，避免 statement timeout
- attachment title builder 改为 attachment-local identity 优先：
  - 不再默认把完整 `final_url` 拼进 child title
  - OCR/image attachment 在缺少高价值 label 时退化成短标题，例如 `附件 4`
  - parent notice 长标题不再被重复塞进 child attachment title

第二类修复直接消除了 2026-04-09 `stratified-002` staged pilot 中的主要 blocker：

- `header_dominant_ocr_chunk_count: 6 -> 0`

### Sample Evidence

本次 sample buckets 为：

- `notice-body`
- `attachment-text`
- `attachment-ocr`

关键样本结论：

- `notice-body` 样本保持结构完整，没有因为 attachment outlier 被整体缩小
- `attachment-text` 样本标题已缩成 `附件 1 / 中央民族大学拔尖创新人才培养&nbsp;“证书项目”报名表`
- `attachment-ocr` 样本标题已缩成 `附件 4`，正文 chunk 现在不再被超长 header 压住

## 2026-04-10 Local Postgres Full Current-Scope Replay And Preparation

### 执行路径

2026-04-10 这条证据消费的是 local Postgres + local MinIO 上已经恢复好的 accepted current scope，而不是 shared Supabase direct-DSN 路径。

正式 CLI 路径为：

- inventory refresh：
  - `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory --corpus campus_notices --collection internal_notice`
- full replay planning：
  - `run_id=local-postgres-wave-d-full-20260410-141615`
- full replay worker：
  - `worker_id=local-postgres-full-04`
- closeout validation：
  - `validate_internal_notice_chunking --closeout-run-id local-postgres-wave-d-full-20260410-141615`
  - `sample_dir=.planning/quick/260410-4zq-postgres-shared-supabase-wave-d/current-scope-samples-full-20260410-141615`
- preparation：
  - `preparation_run_id=prep-local-postgres-wave-d-full-20260410-141615`
- preparation validation：
  - `validate_internal_notice_chunking --preparation-run-id prep-local-postgres-wave-d-full-20260410-141615`
  - `sample_dir=.planning/quick/260410-4zq-postgres-shared-supabase-wave-d/prep-samples-full-20260410-141615`

固定边界：

- 没有执行 `release_registry_scope`
- 没有触发 embedding provider
- 没有写 Qdrant
- 没有发布 alias

### Inventory Verdict

inventory refresh 结果为：

- `notice_count = 20`
- `expected_document_count = 21`
- `expected_attachment_document_count = 1`
- `expected_ocr_candidate_count = 0`
- `notice_risk_counts.body_only = 16`
- `notice_risk_counts.body_with_reference_only_attachments = 1`
- `notice_risk_counts.body_with_spatial_attachments = 2`
- `notice_risk_counts.body_with_text_attachments = 1`

这说明当前 accepted current scope 下已经没有 attachment 被默认送进 OCR lane；两条选课通知里的 `5` 个操作指引类 inline image 已全部转入 `manual_review_required`。

### Closeout Verdict

`run_authenticated_notice_closeout_worker` 对 `local-postgres-wave-d-full-20260410-141615` 的结果为：

- `state = verified`
- `staged_document_count = 21`
- `manual_review_required_attachment_count = 5`
- `materialized_ocr_attachment_document_count = 0`

对应 closeout validator 结果为：

- `passed = true`
- `selection_mode = verified_closeout_run`

因此当前 local current scope 至少可以写成：

- `current-scope replay verified on local Postgres`

不能写成：

- `release completed`
- `index release completed`

### Preparation Verdict

`prepare_registry_scope_chunks` 对 `prep-local-postgres-wave-d-full-20260410-141615` 的结果为：

- `validation_status = passed`

对应 preparation validator 结果为：

- `passed = true`
- `selection_mode = preparation_manifest`

因此当前 local current scope 可以进一步写成：

- `local current-scope preparation quality accepted`

但仍不能写成：

- `embedding / Qdrant / alias publish completed`

### 执行中发现的固定操作规则

同日第一次 full replay 尝试 `local-postgres-wave-d-full-20260410-141313` 曾在 verifier 失败；根因不是 worker 逻辑，而是 inventory 没有先按新 routing 规则重建。

固定结论：

- planner / verifier 读取的是持久化 inventory，不是 live source objects 的即时重算
- source projection / attachment routing 规则一旦变化，就必须先执行 `rebuild_authenticated_notice_source_truth_inventory`
- 否则 verifier 仍会沿用旧的 `expected_ocr_candidate_count` 等 frozen 计数，把已修正的 run 错判为失败

### Sample Evidence

当前 full current-scope sample evidence 固定见：

- `.planning/quick/260410-4zq-postgres-shared-supabase-wave-d/current-scope-samples-full-20260410-141615`
- `.planning/quick/260410-4zq-postgres-shared-supabase-wave-d/prep-samples-full-20260410-141615`

关键样本结论：

- `notice-risk-spatial` 样本已明确显示高风险 inline image 不再进入 OCR lane
- `attachment-text` 样本继续保持独立 child document，不影响 parent notice body 质量
- `notice-body` 样本未因 attachment outlier 被整体缩小或全局劣化

### 当前结论

2026-04-10 的这轮 evidence 现在固定说明：

1. local Postgres current-scope replay + preparation 已经跑通并通过 validator。
2. Wave D 当前 stop 已从“等待 current-scope refresh”前进到“verified chunk preparation，等待是否继续 release 的单独批准”。
3. 选课通知里的 `5` 个操作指引类 inline image 现在已正确落到 `manual_review_required`，而不是 OCR lane。

## 2026-04-06 Current Scope Failure

### 执行方式

本次验收通过 repo 内只读 validator 执行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking \
  --sample-dir /tmp/internal_notice_chunk_samples_20260406
```

输入范围：

- `selection_mode=current_scope`
- `corpus=campus_notices`
- `collection=internal_notice`
- 未向 Postgres、对象存储 derived truth、embedding provider 或 Qdrant 写入任何数据

### Verdict

本次结果固定为：

- `failed`

因此当前 `internal_notice` 只能写成：

- `structurally scannable but not quality accepted`

不能写成：

- `internal_notice offline preparation accepted`

### Repo Remediation Status

截至 2026-04-06，针对这份证据里最明确的实现级 blocker，repo 已经补上两项 remediation：

- derived attachment artifact key 现在按完整 `document_id` 派生稳定目录 identity；不同 notice 下同名 `attachment-0001` 不再共享同一路径
- `attachment_ocr_required` lane 已改成结构化 materialization：OCR child document 会额外落 `layout-elements.jsonl`，并把正文拆成 `section_text` / `table_unit` 等结构化单元，canonical markdown 与最终 document units 不再直接承接 raw html table markup

这两项只能说明：

- repo implementation 已朝正确方向修复

它们还不等于：

- 历史 current scope 已重新跑完 validator
- 本文上面的 `failed` verdict 已被自动推翻

因此在新的真实 replay + validator evidence 产出之前，本文仍保留这次 run 的历史失败结论。

### Summary

本次 run 的 machine-readable summary 如下：

- `registry_record_count=6962`
- `selected_record_count=6962`
- `validated_document_count=6961`
- `total_units=118569`
- `total_chunks=42273`

lane 分布：

- `notice_body`: `6694` docs / `41173` chunks
- `attachment_ocr_required`: `265` docs / `1094` chunks
- `attachment_text_extractable`: `2` docs / `6` chunks

结构观察：

- `split_reason=token_guardrail`: `2033`
- `notice_body_token_guardrail_chunk_count=779`

这些指标本身不直接构成 blocker；真正 blocker 在下文。

### Blocking Findings

### 1. Derived attachment identity mismatch

存在 1 条 attachment child document 无法通过 chunk build：

- `document_id=notice_attachment:muc_internal_portal:353901:attachment-0001`
- `artifact_key=campus_notices/documents/internal_notice/关于两校区通勤班车新增班次的通知-附件-1-1-jpg--attachment-0001/source-faithful/2025/document-units.jsonl`
- validator 读到的 `structured doc_id` 实际是 `notice_attachment:muc_internal_portal:354270:attachment-0001`

这不是质量观感问题，而是 derived artifact identity truth 被污染，必须先修。

### 2. OCR attachment cleanup 仍大量泄漏 raw markup

- `markup_leak_chunk_count=724`

当前失败样本清楚表明，OCR attachment 的 `attachment_body` 里仍残留：

- `<div ...>`
- `<table ...>`
- `<tr><td ...>`

这说明当前 attachment cleanup 还没有把 OCR / layout extraction 结果收敛成 repo 期望的 clean text / structured text truth。

### 3. OCR lane 仍存在 header-dominant 与 noise-suspect chunks

- `header_dominant_ocr_chunk_count=130`
- `noisy_ocr_chunk_count=31`

这说明 OCR lane 里仍有一批 chunk：

- 标题 header 已经明显压过正文
- 正文仍带脏表格片段、截断片段或低信息密度内容

这类问题必须在 OCR attachment lane 内收口，不能通过进一步缩小 `notice_body` budget 来“均摊”。

### 4. Notice body 只有少量 fragmentation，但仍未清零

- `notice_body_fragmentation_count=5`

这说明 parent notice body 不是当前主瓶颈，但仍存在少量过切样本，需要和 attachment 问题分开处理。

### Non-Blocking Observations

以下结果说明当前 lane separation 方向是对的：

- `missing_title_chunk_count=0`
- `missing_contextualization_count=0`
- `missing_lane_metadata_count=0`
- `missing_attachment_lineage_count=0`
- `attachment_without_body_count=0`
- `replacement_character_chunk_count=0`

这意味着：

- title / contextualization / lane metadata / attachment lineage 传播已经基本稳定
- 当前主要缺口不是 metadata completeness
- 当前主要缺口是 OCR attachment cleanup 与少量 derived artifact identity corruption

### Sample Evidence

本次 run 导出的 sample buckets 包含：

- `notice-body`
- `attachment-text`
- `attachment-ocr`
- `notice-body-fragmentation`
- `ocr-noise-suspect`
- `html-leak-or-markup-leak`

关键样本结论：

- `notice-body-fragmentation` 样本显示正文主链路总体可读，fragmentation 只在少量样本上出现
- `ocr-noise-suspect` 样本显示 OCR attachment 直接把 HTML table 片段带进 chunk text
- `html-leak-or-markup-leak` 样本进一步证明 cleanup 尚未把 `<div>` / `<table>` 这类 raw markup 清掉

本次本机 sample export 输出目录为：

- `/tmp/internal_notice_chunk_samples_20260406`

### Current Closeout

截至 2026-04-06，这次验收可收口的结论是：

1. `internal_notice` 不可进入 embedding / Qdrant / release。
2. parent notice body 质量整体可保，但不能拿它来掩盖 attachment lane 的真实问题。
3. 下一步必须优先修两类问题：
   - derived attachment `document-units.jsonl` identity mismatch
   - OCR attachment cleanup / semantic normalization

只有在上述 blocker 清零后，才应再次运行质量验收并更新本证据文档。

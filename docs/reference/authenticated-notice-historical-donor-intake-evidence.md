---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-10
---

# Authenticated Notice Historical Donor Intake Evidence

## 文档边界

本文只记录 `rag-data` historical donor 吸纳到 repo-owned `authenticated_notice_portal` bootstrap seam 的当前 acceptance evidence。

它回答的是：

- 当前 donor intake 批次分别用了什么输入
- 规范化和本地 smoke 是否已经重新验证通过
- attachment-routing probe 当前到底覆盖了什么
- 这份 evidence 可以支持什么结论

它不替代：

- `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md` 的操作步骤
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 source-truth replay / preparation workflow
- `docs/reference/internal-notice-offline-preparation-quality-evidence.md` 的 chunk quality 证据

## Accepted Batches

### Batch 1

- `batch_id=run14-policy-regulation-core-v1`
- `family=policy_regulation`
- `selection_path=configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-core.v1.json`
- `donor_bundle=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json`
- `donor_manifest=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json`
- `legacy_notice_types=/home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json`

selected notice ids：

- `355282`
- `351704`
- `351699`
- `351119`
- `191705`
- `191177`
- `191176`
- `187233`
- `177880`

### Batch 2

- `batch_id=run14-attachment-routing-probe-v1`
- `families=operational_procedure + other`
- `selection_path=configs/ingestion/campus_notices/internal_notice/historical-batches/run14-attachment-routing-probe.v1.json`
- `donor_bundle=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json`
- `donor_manifest=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json`
- `legacy_notice_types=/home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json`
- `attachment_analysis_path=.tmp/historical-intake/run14-attachment-routing-probe/donor-attachment-routing-analysis.json`

selected notice ids：

- `355119`
- `354862`
- `354192`
- `351118`

selection boundary：

- `351111` 已在 donor byte-aware routing 分析中确认是二维码 `reference_only` 样本，不纳入第二批 local-smoke acceptance batch
- 当前 donor snapshot 在现有规则下没有稳定的 `manual_review_required` 批量样本，因此第二批不宣称覆盖这一终态

### Batch 3

- `batch_id=run14-policy-regulation-expanded-v1`
- `family=policy_regulation`
- `selection_path=configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-expanded.v1.json`
- `donor_bundle=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json`
- `donor_manifest=/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json`
- `legacy_notice_types=/home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json`
- `policy_analysis_path=.tmp/reports/run14-policy-regulation-expanded-analysis.json`

selected notice ids：

- `355282`
- `354006`
- `353963`
- `351907`
- `351704`
- `351699`
- `351119`
- `196411`
- `191705`
- `191177`
- `191176`
- `187233`
- `187004`
- `186977`
- `186957`
- `177880`

selection boundary：

- 这是在第一批 policy core 基础上扩大到 `16` 条 `policy_regulation` notice 的 broad sample
- 当前 donor snapshot 中 `354011`、`204923` 仍是 donor-incomplete 的弱样本，不纳入这一批
- `187467` 是征求意见稿通知，不作为 finalized policy batch 样本

## Verification

### Targeted Tests

执行命令：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_legacy_export \
  tests.ingestion.test_authenticated_notice_import \
  tests.ingestion.test_authenticated_notice_notice_family
```

结果：

- `Ran 17 tests`
- `OK`

这次重跑覆盖了：

- legacy donor normalization contract
- authenticated notice import contract
- notice-family classification rules

### Normalization Evidence

执行命令：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --notice-types-path /home/reptilian/code/rag-data/muc-notice-collector/config/notice-types.json \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-core.v1.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --output-dir .tmp/historical-intake/run14-policy-regulation-core/normalized \
  --export-scope run14-policy-regulation-core
```

machine-readable outputs：

- `.tmp/historical-intake/run14-policy-regulation-core/normalized/notices-bundle.normalized.json`
- `.tmp/historical-intake/run14-policy-regulation-core/normalized/export-manifest.normalized.json`
- `.tmp/historical-intake/run14-policy-regulation-core/normalized/normalization-summary.json`

结果摘要：

- `original_notice_count = 6694`
- `normalized_notice_count = 9`
- `missing_notice_ids = []`
- `notice_type_policy_count = 16`
- `normalization-summary.json mtime = 2026-04-09 16:41:21 +08:00`

### Local Smoke Evidence

执行命令：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap_local \
  --bundle-path .tmp/historical-intake/run14-policy-regulation-core/normalized/notices-bundle.normalized.json \
  --manifest-path .tmp/historical-intake/run14-policy-regulation-core/normalized/export-manifest.normalized.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --local-output-dir .tmp/historical-intake/run14-policy-regulation-core/local-smoke \
  --summary-output-path .tmp/historical-intake/run14-policy-regulation-core/local-smoke-summary.json \
  --expect-notice-count 9
```

machine-readable outputs：

- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke-summary.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/registry/source-truth-inventory.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/registry/documents.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/registry/raw-assets.json`
- `.tmp/historical-intake/run14-policy-regulation-core/local-smoke/object-store/uploads.json`

结果摘要：

- `ok = true`
- `notice_count = 9`
- `created_document_ids = 9`
- `updated_document_ids = 0`
- `skipped_document_ids = 0`
- `raw_uploaded_count = 9`
- `raw_reused_count = 0`
- `errors = []`
- `local-smoke-summary.json mtime = 2026-04-09 16:41:20 +08:00`

### Batch 2 Donor Attachment Routing Evidence

repo 当前 attachment classifier 已对 donor blob-store 做只读 byte-aware 判定，machine-readable output：

- `.tmp/historical-intake/run14-attachment-routing-probe/donor-attachment-routing-analysis.json`

结果摘要：

- selected batch target totals：`ocr_required = 5`、`text_extractable = 1`、`reference_only = 1`
- extra excluded sample：`351111` 的唯一附件为二维码图片，当前被 repo classifier 判定为 `reference_only`
- `manual_review_required`：当前 donor snapshot 未形成稳定批次样本

### Batch 2 Normalization Evidence

machine-readable outputs：

- `.tmp/historical-intake/run14-attachment-routing-probe/normalized/notices-bundle.normalized.json`
- `.tmp/historical-intake/run14-attachment-routing-probe/normalized/export-manifest.normalized.json`
- `.tmp/historical-intake/run14-attachment-routing-probe/normalized/normalization-summary.json`

结果摘要：

- `original_notice_count = 6694`
- `normalized_notice_count = 4`
- `missing_notice_ids = []`
- `notice_type_policy_count = 16`
- `normalization-summary.json mtime = 2026-04-09 17:29:51 +08:00`

### Batch 2 Local Smoke Evidence

machine-readable outputs：

- `.tmp/historical-intake/run14-attachment-routing-probe/local-smoke-summary.json`
- `.tmp/historical-intake/run14-attachment-routing-probe/local-smoke/registry/source-truth-inventory.json`
- `.tmp/historical-intake/run14-attachment-routing-probe/local-smoke/registry/documents.json`
- `.tmp/historical-intake/run14-attachment-routing-probe/local-smoke/registry/raw-assets.json`
- `.tmp/historical-intake/run14-attachment-routing-probe/local-smoke/object-store/uploads.json`

结果摘要：

- `ok = true`
- `notice_count = 4`
- `created_document_ids = 4`
- `updated_document_ids = 0`
- `skipped_document_ids = 0`
- `raw_uploaded_count = 4`
- `raw_reused_count = 0`
- `errors = []`
- `local-smoke-summary.json mtime = 2026-04-09 17:30:37 +08:00`

### Batch 3 Policy Analysis Evidence

repo 当前已对 `policy_regulation` 的 `19` 条 `priority_now` 候选做正文形态分析，machine-readable output：

- `.tmp/reports/run14-policy-regulation-expanded-analysis.json`

结果摘要：

- `policy_regulation_notice_count = 19`
- 当前 expanded batch 采纳了其中 `16` 条 donor-internal 样本
- donor source shape totals：`body_is_policy_text = 3`、`body_contains_substantial_policy_text = 8`、`wrapper_notice_likely_external_canonical_text = 4`、`wrapper_or_summary_notice = 1`

### Batch 3 Normalization Evidence

machine-readable outputs：

- `.tmp/historical-intake/run14-policy-regulation-expanded/normalized/notices-bundle.normalized.json`
- `.tmp/historical-intake/run14-policy-regulation-expanded/normalized/export-manifest.normalized.json`
- `.tmp/historical-intake/run14-policy-regulation-expanded/normalized/normalization-summary.json`

结果摘要：

- `original_notice_count = 6694`
- `normalized_notice_count = 16`
- `missing_notice_ids = []`
- `notice_type_policy_count = 16`

### Batch 3 Local Smoke Evidence

machine-readable outputs：

- `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke-summary.json`
- `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/source-truth-inventory.json`
- `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/documents.json`
- `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/raw-assets.json`
- `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/object-store/uploads.json`

结果摘要：

- `ok = true`
- `notice_count = 16`
- `created_document_ids = 16`
- `updated_document_ids = 0`
- `skipped_document_ids = 0`
- `raw_uploaded_count = 16`
- `raw_reused_count = 0`
- `errors = []`

## Scope Characteristics

### Batch 1

这批 `9` 条 donor notice 的 inventory 特征当前固定为：

- `notice_count = 9`
- `notice_risk_label.body_only = 9`
- `attachment_ref_total = 0`
- `attachment_document_total = 0`

因此这批 evidence 的作用固定是：

- 先证明 donor normalization/import seam 稳定
- 先证明 parent-only governance / regulation notices 可以安全进入 repo-owned source-truth intake

补充说明：

- 这里的 `attachment_ref_total = 0` 只描述 2026-04-03 donor export contract 的结果，不等同于 portal live truth
- 2026-04-09 已用 live detail API 复核这批 core 样本中的 `355282 / 351704 / 351699`，三条 notice 都存在 `notice_info.notice_annext`
- 漏抓根因已经确认是 donor / collector 早期版本只消费正文 HTML 锚点，没有消费 detail `notice_annext`
- 这三条样本的当前 accepted 消费策略固定为：
  - `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
    - `.docx` -> `text_extractable`
  - `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
    - `.pdf` -> `ocr_required`
  - `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
    - `.pdf` -> `ocr_required`
- `351704` 与 `351699` 的 live PDF 字节内容相同，`sha256 = f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc`；后续 OCR 应按内容 hash 去重

它没有覆盖：

- text-extractable attachment
- OCR attachment
- `manual_review_required`
- `reference_only`

### Batch 2

这批 `4` 条 donor notice 的 local smoke inventory 特征当前固定为：

- `notice_count = 4`
- `attachment_ref_total = 7`
- `attachment_document_total = 1`
- `text_extractable_total = 1`
- `ocr_required_total = 5`
- `reference_only_total = 1`
- `manual_review_required_total = 0`
- `notice_risk_label.body_with_text_attachments = 3`
- `notice_risk_label.body_with_reference_only_attachments = 1`

这批 evidence 的作用固定是：

- 证明 donor normalization/import seam 已经拿到小批量 attachment route coverage
- 证明 `text_extractable` / `ocr_required` / `reference_only` 三类 attachment 已经各自有 repo-tracked donor batch
- 证明 `internal_notice` 可以在不触碰 Postgres、Qdrant、embedding 的前提下，对 attachment-bearing notice 做受控 intake

它仍然没有覆盖：

- `manual_review_required`
- 实际 OCR 执行结果
- attachment child document 的完整 materialization 验收
- chunk preparation / release gate

### Batch 3

这批 `16` 条 donor notice 的 local smoke inventory 特征当前固定为：

- `notice_count = 16`
- `notice_risk_label.body_only = 16`
- `attachment_ref_total = 0`
- `attachment_document_total = 0`

这批 evidence 的作用固定是：

- 把 `policy_regulation` 从第一批小 core 扩到更大范围的 donor batch
- 显式区分“正文即制度”与“wrapper notice”两种 policy source shape
- 为后续“制度正文优先处理”提供更大的 repo-tracked policy sample

补充说明：

- 这批 expanded donor evidence 里仍然会看到若干 `wrapper notice` 呈现 `attachment_ref_total = 0`
- 对这类 policy wrapper，不得直接把 donor body 视作完整制度正文；应优先用 live detail API 校验是否存在 `notice_annext`
- 目前已经确认至少 `355282 / 351704 / 351699` 三条 regulation wrapper notice 属于这种“donor body-only, portal live has attachment”情形
- 对其中的 `.pdf` 样本，不再把 native PDF extraction 视为默认主链路；canonical 目标改为 cloud async OCR

它仍然不能说明：

- donor body 已经等价覆盖了所有 canonical policy text
- wrapper notice 对应的正式制度原文已经被补齐
- `policy_regulation` 已经完成 replay / chunk / release 验收

### Batch 3 Processing Strategy

这批 `run14-policy-regulation-expanded-v1` 的后续处理，不应按“一批 notice 一套统一策略”推进，而应固定拆成三个 processing cohort。

#### Cohort A：正文可直接消费的制度正文

范围固定为：

- `body_is_policy_text = 3`
  - `353963`
  - `351907`
  - `187004`
- `body_contains_substantial_policy_text = 8`
  - `354006`
  - `196411`
  - `191705`
  - `191177`
  - `191176`
  - `187233`
  - `186977`
  - `186957`

这 `11` 条 notice 的 accepted strategy 固定为：

- `OCR`：当前不进入 OCR lane
- `split`：走 `notice_body` lane，并按制度正文的编号层级做 semantic split，优先识别：
  - `一、二、三、...`
  - `（一）（二）（三）...`
  - `1. 2. 3.`
  - `① ② ③`
- `cleaning`：
  - 保留条款编号、文件号、日期、电话、邮箱、URL
  - 统一空白、全角/半角与异常断行
  - 清除 raw html / markup 泄漏
  - 不因为个别短段落而丢失条款标题或编号
- `chunking`：
  - 固定进入 `chunk-profile.json` 的 `notice_body` lane
  - runtime budget 继续采用 `260 / 320 / 32 / 48`
  - 但实际聚合原则优先是“条款段/小节完整”，不是按 token 均匀切碎
  - 长条款允许在同一大节内继续按二级编号切分；短标题行不得单独悬空成无正文小碎块

这组样本应作为后续第一批 `policy_regulation` chunk-prep / quality acceptance 的主样本。

#### Cohort B：已确认或高度怀疑存在 canonical 附件的 wrapper notice

当前固定包括：

- `355282`
  - live 已确认有 `1` 个 `.docx` 附件
  - accepted lane：`text_extractable`
- `351704`
  - live 已确认有 `1` 个 `.pdf` 附件
  - accepted lane：`ocr_required`
- `351699`
  - live 已确认有 `1` 个 `.pdf` 附件
  - accepted lane：`ocr_required`
  - 与 `351704` 的 live PDF `sha256` 相同，后续 OCR 必须按内容 hash 去重
- `351119`
  - donor body 明确指向“信息门户-文件发布”中的正式文件
  - 当前按 `wrapper_notice_likely_external_canonical_text` 处理

这组样本的 accepted strategy 固定为：

- parent notice 继续保留为 source-truth / source-faithful notice
- donor body 不得直接当作最终制度正文进入第一批 policy-body chunk baseline
- 真正进入 downstream chunk truth 的 canonical body，应优先来自补齐后的 attachment / 外部正式文件
- `355282` 的附件补齐后：
  - 走 `attachment_text_extractable`
  - 先 native text extraction，再 cleanup / chunk
  - chunk runtime budget 用 `220 / 320 / 32 / 32`
- `351704 / 351699` 的附件补齐后：
  - 默认走云端 async OCR
  - 不允许把 native PDF text layer 当成 canonical fallback
  - chunk runtime budget 用 `180 / 240 / 24 / 24`
- `351119` 在正式文件未补齐前，只保留 wrapper notice，不进入第一批制度正文 chunk-prep

#### Cohort C：只有摘要/发布语义的 wrapper notice

当前固定为：

- `177880`

这类样本的 accepted strategy 固定为：

- 当前 donor body 只作为发布/施行摘要保留
- 不把它误写成完整《管理办法》正文
- 在 canonical 原文未补齐前，不进入第一批制度正文 chunk baseline
- 如后续补到正式制度文件，再按附件真实类型决定 `text_extractable` 或 `ocr_required`

#### Wrapper Notice 的统一边界

对 Batch 3 中所有 wrapper 类样本，固定禁止：

- 因 donor body“看起来像通知正文”就把它直接当作完整制度文本
- 在未补齐 canonical body 前，把 wrapper notice 计入制度正文质量通过样本
- 对 `pdf` 走 native extraction 成功路径冒充 canonical truth

固定允许：

- 先导入 source-truth
- 保留 wrapper notice 本身的发布/施行上下文
- 等 live attachment 或正式文件补齐后，再让 canonical body 进入 attachment lane

#### Duplicate Handling

Batch 3 当前保留的重复 source unit 继续按现有 contract 处理：

- `351704 / 351699`
- `191177 / 191176`

accepted strategy 固定为：

- import / source-truth 阶段不按标题去重
- notice identity 继续按稳定 `notice` 资源保留
- 只有 attachment child materialization 才允许按内容 hash 去重计算 OCR
- 不在当前 donor-intake seam 上做“看起来相同正文就合并为一个 notice document”的投机性去重

## Contract Checks

当前两批本地生成的 source-truth manifest 都已确认：

- `fetcher_name = authenticated_notice_bundle_import`
- `fetcher_version = authenticated_notice_legacy_bootstrap_normalized_v1`
- `collector_version = legacy_authenticated_notice_export_v3`
- `source_channel = authenticated_notice_portal`
- `site_id = muc_internal_portal`

这说明 source-truth metadata 语义已按 repo 当前约定收口：

- `fetcher_version` 来自 normalized donor manifest schema
- `collector_version` 来自 legacy export contract version

## Identity Preservation

这批 donor intake 明确保留了 source-level duplicate notice identity，而不是按标题去重。

当前保留的同标题不同 notice ids 样本：

- `351704` / `351699`
- `191177` / `191176`

这是当前预期行为，因为 repo 当前 intake 单位仍是稳定 `notice` 资源，而不是“看起来相同的一条制度文本”。

## Verdict

当前可以写成：

- `run14-policy-regulation-core-v1 accepted as the first historical donor intake batch`
- `run14-attachment-routing-probe-v1 accepted as the second historical donor intake batch`
- `run14-policy-regulation-expanded-v1 accepted as the third historical donor intake batch`
- `legacy donor export -> normalized bundle -> local bootstrap smoke` 这条 seam 已经 repo-tracked
- 第一批样本可以作为 parent-only governance baseline
- 第二批样本可以作为 attachment-routing donor baseline for `text_extractable` / `ocr_required` / `reference_only`
- 第三批样本可以作为更大范围的 `policy_regulation` baseline，并支持后续把 policy body 与 wrapper notice 拆开处理

当前不能写成：

- `internal_notice current scope accepted`
- `authenticated notice replay accepted`
- `chunk preparation accepted`
- `embedding / Qdrant release ready`

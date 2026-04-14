---
doc_type: runbook
status: active
created: 2026-04-11
updated: 2026-04-14
---

# Internal Notice Regulation Promotion Runbook

## 文档边界

这份 runbook 只描述一件事：

- 如何把 `campus_notices/internal_notice` 中已经通过 promotion gate 的 canonical regulation text 物化到 `regulations/institutional_regulations`

它不替代：

- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 replay / closeout / release 主链路
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md` 的验收标准
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md` 的边界决策
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md` 的 file-release 下游 readiness contract

## 当前边界

- source scope 固定为 `campus_notices/internal_notice`
- target scope 固定为 `regulations/institutional_regulations`
- target collection posture 固定为 `offline_preparation`
- 当前 runbook 只覆盖 manifest build + target materialization
- 当前 runbook 不覆盖 chunk preparation、embedding、Qdrant release、alias publish

当前标题/version 语义补充：

- 本 runbook 记录的是当前 execution truth
- 截至 2026-04-14，当前 execution 已使用 `regulation_work_title` 作为 target `document_id` 输入
- 当前 projected/materialized `title` 已使用 `regulation_display_title`
- promotion / projection / materialization 当前同时保留 `regulation_title_normalized / regulation_work_title / regulation_edition_label / regulation_display_title / source_title_literal`
- 长期 title/version contract 设计依据见：
  - `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- 2026-04-14 已完成一次受控 replay/rematerialization：
  - Cohort A formal local current-scope 已完成 fresh refresh
  - `355282` 已进一步完成 source-truth repair + targeted source projection rebuild + filtered materialization，正式进入 local current target
- 当前 formal local current target count 已为 `11`
- 当前 remaining migration work 已不再是 `355282` replay/rematerialization，而是后续 admitted import 与下游消费收敛；frontier 只剩 `351119`

## 执行顺序

### 0. 如 attachment owner 未投影，先做定向 source projection rebuild

当某条 notice 已确认应该由 attachment owner 推进，但当前 `campus_notices/internal_notice` scope 中缺少对应 `notice_attachment:*` 子文档时，先执行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_projections \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id 355282
```

固定 operator 规则：

- `--notice-id` 可重复传入多次
- 当传入 `--notice-id` 时，当前 source projection rebuild 是定向、非破坏性的：
  - 只重建指定 notice 的 source projection
  - 不会对整个 `campus_notices/internal_notice` scope 执行 whole-scope refresh
- 这一步只修 source/attachment projection，不等于 regulation target materialization
- 完成后再继续 manifest build + target materialization

### 1. 先看 promotion manifest

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest \
  --corpus campus_notices \
  --collection internal_notice
```

可选过滤：

- `--notice-id <id>`
- `--document-id <id>`
- `--promotion-routing-path <path>`

operator 目标：

- 先确认本轮 `promote_candidate / hold_in_internal_notice / manual_review_required` 分布
- 确认新增 `promote_candidate` 是否真的是制度 owner 文本，而不是 wrapper notice 的正文引用或章节标题误判
- 再执行 target collection materialization

固定 operator 规则：

- parent notice 的 formal-regulation admission 只能信任 title-signal text，不得用正文里的 `办法 / 意见 / 方案` 引用词替代
- `一、选课范围`、`第X条`、`（一）...` 这类 body heading 不得作为 regulation title 证据
- 当前 local current scope 仍只能对白名单 candidate 做 materialization，不能对未审 current scope 直接全量推进
- 截至 2026-04-14，current-scope direct parent-body expansion 已为空；`355282` 已不再是 recovery frontier，下一批优先级收缩为 `351119`
- 截至 2026-04-14，repo 已能对 `file_release` export 做 bounded readiness 判定；但它当前还不会恢复 owner body，也不会自动改写 promotion 结果

### 2. 执行 target collection materialization

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
  --corpus campus_notices \
  --collection internal_notice
```

可选过滤：

- `--notice-id <id>`
- `--document-id <id>`
- `--promotion-routing-path <path>`

当前 worker 固定行为：

- 只消费 `promote_candidate`
- target `document_id` 不从 `notice_id` 派生
- target `document_id` 当前由 `regulation_work_title + issuing_org + semantic scope` 派生
- duplicate candidate 会合并到一个 promoted target document，并在 metadata 中聚合 provenance
- target scope 使用 scope refresh，全量替换 `regulations/institutional_regulations`

### 3. Repo-local snapshot mode

如果需要脱离 env backends，用本地快照运行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates \
  --documents-json /tmp/internal-notice-documents.json \
  --source-truth-inventory-json /tmp/internal-notice-source-truth-inventory.json \
  --object-store-root /tmp/object-store-root
```

固定要求：

- `--documents-json`
- `--source-truth-inventory-json`
- `--object-store-root`

必须三者同时提供。

operator 规则：

- `--object-store-root` 不得直接指向长期复用的 source snapshot 输出根并在其上原地写 target artifacts
- local-only materialization 验收必须使用隔离的 snapshot/overlay 输出目录承接 `regulations/institutional_regulations` 写入
- source snapshot 只作为 read side truth；target materialization evidence 需要单独落盘，避免污染长期 `local-smoke` 目录

## 当前输出真相

materialization 当前会写入：

- `regulations/documents/institutional_regulations/.../canonical.md`
- `regulations/documents/institutional_regulations/.../document-units.jsonl`
- `regulations/institutional_regulations` registry rows

metadata 当前至少保留：

- `promotion_class`
- `promotion_source_collection`
- `source_notice_ids`
- `source_notice_document_id`
- `source_notice_document_ids`
- `source_document_ids`
- `source_parent_document_id`
- `source_attachment_document_id`
- `source_attachment_document_ids`
- `source_attachment_ref_id`
- `source_attachment_ref_ids`
- `source_attachment_sha256`
- `source_attachment_sha256s`
- `semantic_owner_document_id`
- `semantic_owner_document_ids`
- `regulation_title_normalized`
- `regulation_work_title`
- `regulation_edition_label`
- `regulation_display_title`
- `source_title_literal`
- `issuing_org`
- `effective_date`
- `revision_signal`

固定 metadata 解释：

- `regulation_display_title` 是 operator / retrieval / materialized title 的显示字段
- `<work title> / <edition label>` 是 repo-local display convention，不是外部标准原文
- `edition_label` 必须保留完整语义：
  - `2026版` 保持 `2026版`
  - `2026年修订` 保持 `2026年修订`
  - 不得统一压成裸年份 `2026`
- `暂行`、`试行`、`民大校发〔2025〕104号`、`2026届` 这类信号不得误拆成 `edition_label`
- `source_notice_release_time` 表达 notice wrapper 的发布/观测时间，属于 provenance
- `effective_date` 只在 owner text 明确给出时提取；缺失允许为 `null`
- 不得把 `source_notice_release_time` 默写成 `effective_date`

当前已验证的样本真相：

- `355282` 当前已完成 formal local current-scope materialization：
  - parent notice 继续留在 `campus_notices/internal_notice`
  - attachment child 作为 regulation owner 进入 target
  - `effective_date` 允许保持为空

## 固定禁止

- 不把 `internal_notice` alias 当作 query-serving 打开
- 不在这个 worker 里直接做 chunk preparation
- 不在这个 worker 里直接做 embedding / Qdrant write
- 不在没有单独批准的情况下做 target collection release / alias publish

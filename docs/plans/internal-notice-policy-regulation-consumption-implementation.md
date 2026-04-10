---
doc_type: plan
status: active
created: 2026-04-10
updated: 2026-04-10
---

# Internal Notice 规章制度消费实施文档

## 文档边界

本文只负责一个问题：

- 如何把 `authenticated_notice_portal -> campus_notices/internal_notice` 当前已经形成的 source-truth / replay / attachment routing 基线，继续推进成“规章制度类通知可被稳定消费”的前向实施方案

它回答的是：

- 当前 merged truth 到了哪一步
- 当前代码、配置和样本事实已经支持什么、不支持什么
- 为什么下一步不能继续把 `policy_regulation` 永久停留在 `internal_notice`
- 应该如何把规章制度类通知拆成 `source absorption -> internal_notice triage -> regulation promotion`
- 附件、文件类型、对象存储、版本、验收和 rollout 应如何设计

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的 source-channel 边界
- `docs/architecture/authenticated-notice-source-truth-contract.md` 的 source-truth contract
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的当前 collection-specific lane strategy
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 operator runbook
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`

## 当前 Merged Truth

截至 2026-04-10，repo 内已经冻结的事实如下：

- source channel 仍是 `authenticated_notice_portal`
- 当前 repo-tracked 下游 collection 仍只有 `campus_notices/internal_notice`
- `internal_notice` 当前 posture 仍是 `restricted + offline_preparation`
- `internal_notice` 还不是 query-serving surface，也还没有 repo-tracked 的 notice-derived `regulations/*` collection
- source-truth unit 固定是 `notice`，不是 collector 本地文件、SQLite row 或某次导出 bundle
- source-truth 之后的 document build 固定采用“父 notice 正文 + attachment child document”两层 projection
- notice-family admission 已经冻结为 read-only triage layer；当前 `priority_now` family 固定为 `policy_regulation`
- attachment typed routing 已经冻结为 `reference_only` / `text_extractable` / `ocr_required` / `manual_review_required` / `unsupported_binary`
- 当前 repo-tracked 默认 lane 已经冻结为：
  - `docx -> text_extractable`
  - `pdf -> ocr_required`
  - 空间关系主导图片 -> `manual_review_required`
  - editor static asset / decorative asset -> `reference_only`
- `pdf` 在 `internal_notice` 中的 canonical 主链路已经冻结为云端异步 OCR；native PDF extraction 只允许作为 diagnostics / probe
- `chunk preparation` 与 `index release` 已经被明确拆开；当前不允许把 replay/preparation 直接揉成 embedding / Qdrant side effects

这意味着：

- 当前 repo 真相已经足够支撑“先把规章制度类通知收干净”的前半段
- 但还没有把“哪些内容应该从 `internal_notice` 继续提升为正式 `regulations/*` 语义 collection”正式落成 repo-level 实施面

## 当前代码与配置现实

结合当前代码和配置，已经成立的现实约束如下：

### 已有能力

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
  - 已支持 `attachment_ref` 分类、`reference_only` 过滤、`docx` 原生提取和 `pdf/image` OCR 候选分流
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
  - 已同时具备 `paddleocr_async_jobs` 和 `paddleocr_vl_service` 两种 provider mode
  - 默认 provider 已是 `paddleocr_async_jobs`
- `configs/ingestion/campus_notices/internal_notice/source-projections.v1.json`
  - 当前 `text_extractable_extensions` 只有 `docx`
  - 当前 `ocr_required_extensions` 已包含 `pdf/png/jpg/jpeg/bmp/gif`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
  - 已明确 historical replay 当前应停在 pilot/verified，不继续 embedding / Qdrant

### 当前缺口

- 当前 repo 还没有 notice-derived formal regulations 的目标 collection config
- 当前 repo 还没有“从 `internal_notice` canonical documents 提升到 `regulations/*`”的跨 collection promotion contract
- 当前 repo 对 Office 文本附件的稳定原生支持只冻结到 `docx`
- 当前 repo 还没有把 `.doc` / `.xls` / `.xlsx` 这类在 `policy_regulation` 样本里真实存在的附件类型纳入稳定消费契约

这几个缺口决定了：

- 下一步不能假装“`policy_regulation` replay 完就等于 regulation corpus 已经成立”
- 也不能把 `.doc` / `.xls` / `.xlsx` 静默当成“已经支持”

## 现有样本事实

当前 repo 已记录的样本事实，已经足够支持规章制度类第一阶段实施：

- `docs/reference/authenticated-notice-portal-live-observations.md` 已确认：
  - `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
    - 附件为 `.docx`
  - `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
    - 附件为 `.pdf`
  - `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
    - 附件为 `.pdf`
- 同一批 live / donor 扩展样本已经确认：
  - `policy_regulation` broad sample 很多并不是 PDF-heavy，而是 Office-heavy
  - `16` 条 expanded sample 中，扩展名分布为 `.pdf=6`、`.doc=11`、`.docx=4`、`.xls=1`、`.xlsx=3`
- 这直接说明：
  - `policy_regulation` 的主问题不是“只有 PDF OCR”
  - 下一步必须把“规章制度提升层”和“Office 二进制附件支持补齐”一起设计

## 外部官方实践摘要

以下外部实践只作为 supporting rationale，不覆盖 repo 内已冻结的 truth。

### 1. 先分类/切分，再做正文消费

Google Cloud Document AI 的 `Custom Splitter` 官方文档明确把“分类 + 拆分长文档中的逻辑子文档”作为独立处理阶段，并支持在置信度不足时走人工复核：

- https://docs.cloud.google.com/document-ai/docs/custom-splitter

对本项目的直接含义是：

- 不能把 portal `notice_type`、notice family、attachment routing、formal regulation promotion 混成一个判断
- 应先做 notice-level family admission，再做 attachment-level routing，再做 regulation-promotion gate

### 2. chunking 应优先尊重文档结构，而不是只调统一窗口预算

Azure AI Search 官方 chunking 文档明确建议优先按标题、章节、段落、表格等结构切分，并把固定窗口切分视为后续尺寸控制手段，而不是唯一策略：

- https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents

对本项目的直接含义是：

- 当前 `220/320/32/32` 只能继续当 admission baseline
- `notice_body`、`attachment_text_extractable`、`attachment_ocr_required` 必须长期走 lane-specific semantic chunking
- 不应该为了附件 outlier 反向全局压缩 parent notice body

### 3. PaddleOCR 官方同时提供同步 layout parsing 和异步 jobs，两者应分工而不是互相替代

百度智能云 OCR / 文档解析官方文档与 AI Studio 官方用法同时覆盖了：

- 同步 layout-parsing 调用
- 异步 jobs 提交、轮询和结果下载

参考：

- https://ai.baidu.com/ai-doc/OCR/7mh8u7ruk

对本项目的直接含义是：

- 对 `internal_notice` historical replay 的主链路，继续固定使用 `paddleocr_async_jobs`
- `paddleocr_vl_service` 只保留给单文件诊断、局部质量探针和手工对照
- async 失败时先检查 attachment routing 和 notice 上下文，不得直接把主链路切回同步 endpoint

## 核心问题定义

当前真正需要解决的不是“如何继续把所有内部通知做完”，而是下面这件事：

- 如何把 `internal_notice` 中已经被 family admission 选中的 `policy_regulation`，继续分成“应保留在 notice 层的 wrapper / operational material”和“应提升为正式 regulation 文档的稳定制度正文”

这一步必须新增，因为 repo 自己已经明确了：

- `internal_notice` 是 source-channel first restricted collection
- 正式规章、正式手册、正式培养方案如果已经有更强语义 owner，下游应进入与 source channel 并列的 `regulations/*`、`curriculum/*`

参考：

- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`

因此，长期正确形态不应是：

- 永远把规章制度类正文锁在 `campus_notices/internal_notice`

而应是：

- `internal_notice` 继续承担 source-channel triage、restricted replay、wrapper notice 审计与附件清洗
- 正式制度正文在质量和语义都满足门禁后，提升到独立 `regulations/*` collection

## 目标消费模型

本文建议采用四层模型。

### Layer 1: Source Absorption

职责：

- collector / import / source-truth 尽量全量吸收 notice、正文块、链接、附件关系

固定真相：

- 仍以 `authenticated_notice_portal` notice source-truth 为 canonical upstream
- 不因为某个 family 当前延后，就在采集层丢 notice

### Layer 2: `internal_notice` Triage And Offline Preparation

职责：

- 作为 source-channel first restricted collection，承接：
  - notice-family admission
  - attachment typed routing
  - parent/child projection replay
  - attachment extraction / OCR / manual-review outcome
  - chunk quality acceptance

固定真相：

- wrapper notice 继续留在 `campus_notices/internal_notice`
- `manual_review_required`、`reference_only`、`no_extractable_text` 继续只保留 relation truth / outcome truth

### Layer 3: Regulation Promotion

职责：

- 从已经通过 replay / extraction / quality gate 的 `internal_notice` canonical documents 中，筛出真正应该提升为正式制度正文的文档

这层是本文新增的前向设计，不是当前 merged truth。

### Layer 4: Regulations Collection

建议新增但当前尚不存在的 target collection：

- `regulations/institutional_regulations`

命名理由：

- 它表达的是“机构正式制度正文”的长期语义 owner
- 它不绑定 `authenticated_notice_portal`
- 后续如果同一制度正文在 `official_web` 出现镜像或 canonical source，也可以进入同一个 collection，而不是再造 source-specific regulation collection

当前这个 collection 建议先保持：

- `serving_stage=offline_preparation`
- `query_enabled=false`

原因：

- 当前还没有被授权推进 embedding / Qdrant / alias publish
- 应先把 regulation promotion、版本、去重和质量 gate 固化

## 分层分类规则

### 第一层：Notice Family

继续沿用当前已冻结的 `policy_regulation` 优先策略。

当前不改：

- `event_activity`
- `lecture_publicity`
- `roster_publication`
- 其他明显非稳定制度正文 family

### 第二层：Promotion Class

对已经进入 `policy_regulation` 的 notice，再增加一层 document-level promotion class。

第一版建议固定为：

- `formal_regulation`
  - 正式管理办法、规定、细则、条例、章程、准则、指导意见
- `normative_handbook`
  - 稳定、长期有效、正文本体足以独立消费的应知应会手册 / 工作手册
- `wrapper_notice_only`
  - 主要价值在“发布/印发/修订通知”本身，正文只是 wrapper，制度正文在附件里
- `draft_or_consultation`
  - 征求意见稿、试行稿、讨论稿
- `annual_or_operational_scheme`
  - 强年限、强批次、强场景绑定的工作方案、实施方案、年度细则

当前第一阶段 promotion 建议只开放：

- `formal_regulation`
- `normative_handbook`

继续留在 `internal_notice` 的类型：

- `wrapper_notice_only`
- `draft_or_consultation`
- `annual_or_operational_scheme`

原因：

- 它们更像 restricted operational context，而不是长期稳定制度正文
- 这可以避免把 notice corpus 里的“年度流程性文件”过早混进正式 regulation corpus

## 附件与文件类型策略

### 已冻结策略

- `docx -> text_extractable`
- `pdf -> ocr_required`
- 文本/表格主导图片 -> `ocr_required`
- 空间导览图、位置图、楼宇分区图 -> `manual_review_required`
- decorative asset / editor static asset -> `reference_only`

### 第一阶段可直接推进的 promotion 输入

- `docx`
- `pdf`

原因：

- 这两类文件在当前 repo 已经有明确的 canonical 主链路
- 其中 `pdf` 已明确冻结为云端异步 OCR 主路径

### 当前必须显式标成“未完成支持”的输入

- `.doc`
- `.xls`
- `.xlsx`

当前建议不要做的错误动作：

- 不把 `.doc` 静默当成 `.docx`
- 不把 `.xls/.xlsx` 直接降级成“先转文本再说”
- 不因为它们暂时未支持，就反向把整个 `policy_regulation` promotion 搁置

正确做法是：

- 第一阶段 promotion 先只纳入 `docx/pdf`
- 把 `.doc` / `.xls` / `.xlsx` 单独列为 `office_binary_gap`
- 在第二阶段新增 `office_binary_extractable` 能力，再扩大 promotion 面

这样做的原因是：

- 当前样本已经证明这批文件真实存在
- 但当前代码和 config 还没有稳定 contract，不能假装已经支持

## 为什么不直接从 Source Truth 一步 Fan-Out 到 `regulations/*`

本文建议不要把 notice source-truth 直接一跳 fan-out 成 regulation collection，而是先过 `internal_notice` triage，再做 promotion。

原因有四个：

1. `internal_notice` 仍然是 source-channel first restricted inventory
   - wrapper notice、attachment relation、manual review outcome 都需要留在这层
2. formal regulation promotion 依赖 quality gate
   - 不是所有被 `policy_regulation` 命中的 notice 都应该直接成为 regulation document
3. promotion 需要跨 notice 去重
   - 同一 PDF 已经被 live 样本证明可能跨 notice 重复出现
4. regulation identity 不应绑定 `notice_id`
   - regulation 的长期 identity 应表达制度正文本身，而不是某次通知包装

## Regulation Promotion Contract

当前建议新增一条 document-level promotion contract，而不是改写 source-truth contract。

### 建议新增的 repo-tracked config

- `configs/ingestion/campus_notices/internal_notice/promotion-routing.v1.json`
  - 描述哪些 notice/document 满足 promotion gate
- `configs/ingestion/regulations/institutional_regulations/runtime-profile.json`
- `configs/ingestion/regulations/institutional_regulations/canonical-profile.json`
- `configs/ingestion/regulations/institutional_regulations/chunk-profile.json`
- `configs/ingestion/regulations/institutional_regulations/source-projections.v1.json`
  - 这里的 `source` 不是 raw asset，而是来自 `internal_notice` canonical document 的 declared promotion

### Promotion Candidate 的最小元数据

建议至少显式记录：

- `promotion_class`
- `promotion_source_collection=campus_notices/internal_notice`
- `source_notice_ids`
- `source_parent_document_id`
- `source_attachment_ref_id`
- `source_attachment_sha256`
- `source_notice_release_time`
- `regulation_title_normalized`
- `issuing_org`
- `effective_date`
- `is_draft`
- `revision_signal`
- `supersedes_candidate_keys`

### Identity And Version

promotion 后的 regulation identity 不应再用 `notice_id` 派生。

建议规则：

- `document_id`
  - 由 `regulation_title_normalized + issuing_org + semantic_scope` 派生
- `version_id`
  - 由 `content_hash + effective_date + revision_signal` 派生
- provenance
  - 必须继续显式保留回链到 source notice 与 source attachment 的字段

## Handbook 关系与版本治理

当前 `regulations/student_handbook` 仍是既有稳定 collection。

对 notice-derived formal regulations，第一阶段不要做以下动作：

- 不覆盖 `student_handbook`
- 不把 notice-derived regulation 混写进 `student_handbook`
- 不在没有 precedence policy 的情况下，直接把 handbook 中的旧文本判成“已失效”

建议规则：

- `student_handbook` 继续保留其既有身份和 release 管理
- `institutional_regulations` 作为并列 collection，承接来自 internal notice 或 official web 的正式制度正文
- 后续如果确实要回答“handbook 旧版本 vs notice 更新版谁优先”，应再单独增加 cross-collection precedence / supersession policy，而不是在 ingestion 阶段硬编码覆盖

## 对象存储与路径编排

沿用现有 data-plane 语义，不新造路径体系。

### Source 层保持不变

继续保留在 source bucket：

- `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/capture/...`
- `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/provider/...`
- `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/source-truth/...`

### `internal_notice` 派生产物保持不变

继续保留在 derived bucket：

- `campus_notices/documents/internal_notice/{title_slug}--{docid8}/{revision_track}/{year}/...`

### 新增 regulation promotion 后的目标路径

建议新增：

- `regulations/documents/institutional_regulations/{title_slug}--{docid8}/{revision_track}/{year}/canonical.md`
- `regulations/documents/institutional_regulations/{title_slug}--{docid8}/{revision_track}/{year}/document-units.jsonl`

promotion / planning / validation artifacts 建议单独落在 target corpus operations prefix：

- `regulations/operations/internal-notice-promotion/{promotion_run_id}/institutional_regulations/promotion-manifest.json`
- `regulations/operations/internal-notice-promotion/{promotion_run_id}/institutional_regulations/validation-summary.json`
- `regulations/operations/internal-notice-promotion/{promotion_run_id}/institutional_regulations/document-reports.jsonl`

这样做的理由：

- source replay 仍属于 `campus_notices`
- regulation promotion 的成功判定已经属于 target collection 的 operations truth

## Chunking 与质量门禁

### 当前结论

- 不冻结新的全局预算数字
- 继续把 `220/320/32/32` 视为 generic admission baseline

### 长期策略

- `notice_body`
  - 保持 structure-first，不因附件 outlier 退化
- `attachment_text_extractable`
  - 按自身 section/table/paragraph 结构切分
- `attachment_ocr_required`
  - 保留 OCR layout 中的 section/table 边界，不把 provider HTML 直接当 final text
- `institutional_regulations`
  - 以制度正文本体为 chunk 单位，不再携带 wrapper notice 叙事

promotion gate 必须额外验证：

- 被提升文档的标题和正文是否已经脱离 wrapper notice 语义
- 附件 OCR / 提取结果是否具备独立消费质量
- 是否与已有 promoted regulation 内容 hash 重复
- 是否存在明显 draft/annual-only 信号

## 实施顺序

### Phase A: 固化当前 truth，不扩 scope

目标：

- 继续保持 `internal_notice` 作为当前唯一 repo-tracked source-channel collection
- 不开启 embedding / Qdrant / alias publish

交付物：

- 本文
- `configs/ingestion/campus_notices/internal_notice/README.md` 入口更新

### Phase B: 新增 promotion contract 与目标 collection scaffold

目标：

- 新增 `regulations/institutional_regulations` config scaffold
- 新增 `promotion-routing.v1.json`

交付物：

- target collection config
- promotion class 规则
- promotion metadata schema

### Phase C: 小样本 promotion pilot

目标：

- 只对已经通过 quality acceptance 的 `docx/pdf` regulation samples 做 bounded pilot

建议固定样本起点：

- `355282` 的 `.docx`
- `351704` / `351699` 的重复 `.pdf`
- run14 expanded batch 中已确认可用的 unique PDF / DOCX 样本

验收重点：

- 去重是否按 attachment hash 生效
- wrapper notice 是否未被误提升
- promotion 后的 document identity 是否脱离 `notice_id`

### Phase D: 补齐 Office 二进制能力

目标：

- 新增 `.doc` / `.xls` / `.xlsx` 的稳定 extraction contract

前提：

- 必须先完成 bounded morphology sampling
- 必须先形成 repo-tracked acceptance evidence

在此之前：

- 这些附件继续留在 `internal_notice`
- 不阻塞 `docx/pdf` 先行 promotion

### Phase E: 形成 regulation quality gate

目标：

- 给 `institutional_regulations` 增加独立 quality acceptance
- 但仍可继续保持 `offline_preparation`

通过条件：

- promoted doc 质量通过
- supersession / duplicate evidence 可审计
- query-surface opening policy 另文决定

## 验收标准

这份实施方案落地后，至少应满足：

1. `internal_notice` 与 `institutional_regulations` 的职责边界清晰
2. wrapper notice 不再冒充制度正文
3. `pdf` 继续固定走 async cloud OCR，不回退到本地或 native PDF 主路径
4. 空间图、位置图、导览图继续停在 `manual_review_required`
5. `.doc` / `.xls` / `.xlsx` 被显式标成未完成支持，而不是静默混入成功路径
6. promotion 后的 regulation identity 不再绑定 `notice_id`
7. 跨 notice 重复附件可按内容 hash 去重
8. 在用户未授权前，不推进 embedding / Qdrant / alias publish

## 当前执行 Phase 拆分

结合当前 repo truth、对象存储现实和已完成的 authenticated-notice foundation / closeout work，后续执行建议按下面六个 phase 推进。

### Phase 12.3：Live/Donor 契约固化

目标：

- 把 live portal 真实字段、登录态采集事实、`rag-data` donor normalized bundle 和 repo-native source-truth contract 固化到同一套入口语义
- 不再继续依赖“同事猜测契约”的 donor shape 作为隐式前提

交付物：

- live/donor contract snapshot
- donor normalization evidence
- notice-type / family sample baseline

通过条件：

- live / donor / repo-native `notice` identity 可一一对齐
- donor normalized bundle 可以稳定重放
- `notice-family-classification.v1.json` 对既有样本输出稳定可重复

### Phase 12.4：Source Attachment Key 重组

目标：

- 修复 `campus-rag-source` bucket 中 authenticated notice 附件仍沿用 donor blob key 的污染
- 不改变两 bucket 架构，不改写 source-truth unit，不碰 embedding / Qdrant

交付物：

- referenced legacy key inventory
- unreferenced legacy key inventory
- `legacy -> canonical` mapping inventory
- source attachment canonical key contract

通过条件：

- 新写入的 attachment source key 不再沿用 donor sha-style top-level key
- 当前仍被 `attachment-refs.jsonl` 引用的 legacy objects 全部存在 canonical 副本
- `source-truth` / provider refs 可稳定重写到 canonical key

### Phase 12.5：`policy_regulation` 分层与附件分流验收

目标：

- 把当前 admitted notice 明确分成 `policy_regulation` / deferred family
- 把 `policy_regulation` 内部再分成 promotion class
- 把 attachment typed routing 做成可审计的稳定执行前置

交付物：

- expanded family classification evidence
- promotion class sample decisions
- attachment routing acceptance note

通过条件：

- admitted 样本中不再混入明显 `event_activity` / `lecture_publicity`
- 空间导览图、位置图、楼宇分区图不进入 OCR lane
- decorative asset / editor static asset 不进入 child document path
- `.doc` / `.xls` / `.xlsx` 被显式标记为 gap，而不是伪装成已支持

### Phase 12.6：Lane Extraction / Chunk Prep Pilot

目标：

- 对小样本 `docx/pdf` 附件跑完整的 extraction / cleanup / chunk preparation / quality validation
- 继续把 canonical stop point 固定在 `verified chunk preparation`

交付物：

- bounded pilot sample set
- lane-specific extraction evidence
- chunk quality validation summary

通过条件：

- `notice_body` 不因附件 outlier 退化成碎块
- `attachment_text_extractable` 保留 attachment lineage 和独立正文结构
- `attachment_ocr_required` 以 async cloud OCR 结果为 canonical 依据
- `manual_review_required` / `reference_only` / `no_extractable_text` 都作为显式 terminal outcome 保留

### Phase 12.7：`institutional_regulations` Promotion Scaffold

目标：

- 新增 `regulations/institutional_regulations` 的 repo-tracked config scaffold
- 新增 `promotion-routing.v1.json`
- 冻结 promotion metadata、identity、version 和 provenance contract

交付物：

- target collection config scaffold
- promotion routing config
- promotion metadata schema / acceptance note

通过条件：

- promoted regulation identity 不再由 `notice_id` 派生
- wrapper notice / draft / annual-only 文档继续停留在 `internal_notice`
- 不覆盖 `student_handbook`

### Phase 12.8：Bounded Promotion Pilot

目标：

- 只对已经通过 Phase 12.6 验收的小样本做 bounded promotion pilot
- 继续保持 `offline_preparation`

交付物：

- promotion pilot manifest
- duplicate / supersession evidence
- target collection validation summary

通过条件：

- 同一制度正文跨多个 notice 只形成一个 promoted canonical document
- promoted document 保留完整 source provenance
- 在用户未授权前，仍不进入 embedding / Qdrant / alias publish

## Stop/Go Gates

当前执行固定按下列 gate 收口：

1. `Phase 12.4` 未通过前，不继续扩大 replay / pilot 范围，因为 source bucket attachment contract 仍然污染
2. `Phase 12.5` 未通过前，不继续扩大 OCR / extraction pilot，因为 attachment routing 还不可信
3. `Phase 12.6` 未通过前，不进入 promotion pilot，因为正文与附件质量还未验收
4. 在用户未明确授权前，不做 current scope mutation，不做 embedding / Qdrant / alias publish

## 非目标

- 当前不把所有 `internal_notice` family 一次性做完
- 当前不把 `internal_notice` 直接开放为 query-serving
- 当前不把年度流程性文件、名单公示、活动通知都提升为 regulation corpus
- 当前不把空间视觉资产重新塞回 OCR lane
- 当前不本地部署 OCR / PDF 模型

## 建议同步更新的后续文档

本文落盘后，后续真正开始实施时，建议继续补齐：

- `docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/decisions/` 下针对“notice-derived regulations target collection”与“office binary attachment strategy”的 ADR

## 相关文档

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/reference/authenticated-notice-portal-live-observations.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`

## 外部参考

- Google Cloud Document AI Custom Splitter
  - https://docs.cloud.google.com/document-ai/docs/custom-splitter
- Azure AI Search chunking guidance
  - https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents
- 百度智能云 OCR / 文档解析官方文档
  - https://ai.baidu.com/ai-doc/OCR/7mh8u7ruk

---
doc_type: plan
status: active
created: 2026-04-10
updated: 2026-04-18
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
- `docs/plans/authenticated-notice-file-release-owner-recovery.md` 的 auth-window `file_release` capture / owner recovery workstream
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的当前 collection-specific lane strategy
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 operator runbook
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`

## 当前 Workstream 设计（2026-04-18）

这条线当前固定为一条单独的 non-auth downstream workstream：

`source-triage -> regulation promotion -> target collection -> target-side quality gate`

直接含义：

- 当前只消费已经捕获好的 `internal_notice` current-scope / admitted target truth，不再把 auth-window `file_release` capture 混进本线
- `351119` 的 `file_release` targeted capture、owner body recovery 与回接 promotion/materialization 已迁移到 `docs/plans/authenticated-notice-file-release-owner-recovery.md`
- promotion materialization、`regulations/institutional_regulations` / `regulations/scoped_rules` target hardening，以及 target-side chunk acceptance 继续只属于同一条 `authenticated-notice -> regulation downstream consumption` workstream 的顺序子层
- 它可以与其他独立 workstreams 并行存在；串行约束只限这条 workstream 内部
- 当前 stop point 继续固定在 `offline_preparation`
- 在用户未明确授权前，不进入 embedding、Qdrant、release、alias publish

当前这条 workstream 的单一入口固定就是本文；后续其他会话接手时，不再重新讨论“是否要先单独开 replay 线 / promotion 线 / target chunk acceptance 线”。

当前前向顺序固定为：

1. 稳住 `internal_notice` source current scope 与 admitted regulation inventory
2. 跑 promotion routing，稳定 `candidate / hold / manual_review_required`
3. 导出 local-only candidate artifacts
4. materialize 到 `regulations/institutional_regulations` / `regulations/scoped_rules`
5. 做 target-side chunk prep / quality acceptance
6. 继续只收口已捕获 corpus 的 metadata / quality truth，不扩成 source-wide replay

当前明确的下一条前向切片仍是：

- 保持现有 `11` 条 admitted regulation target 的 bounded lane
- 不做 unfiltered source-wide materialization
- scoped-rules 继续只做 non-auth metadata / target-side quality hardening；annual rule 缺少 `school_unit_name` 视为 target-side fail-close，`暂行/试行` 继续保留 `force_status=provisional_in_force`
- 需要认证窗口的 `351119` `file_release` capture 与 owner recovery 不再属于本文，统一转到独立 auth workstream

当前这条 workstream 的固定后续顺序也已经明确：

1. 先完成当前 target-side chunk / metadata / quality acceptance
2. 再收口 `legacy Office normalization + bounded metadata truth`

其中第二段固定只包括：

- 修正文档真相：明确 `xls/xlsx` 已支持、`.doc` 仍未支持
- 冻结 `.doc` 的 legacy Office normalization contract，不在 repo 内手写二进制 parser
- 增加 worker-owned normalizer / provenance contract
- 评估把 `.doc` 的当前 replay-time exception fail-close 收口成可盘点的 terminal outcome / backlog semantics

固定不包括：

- auth owner recovery
- query-serving reopen
- embedding、Qdrant、release、alias publish

后续其他会话接手时，应直接按本文推进，不再为以下事项单独重开并发 lane：

- historical donor / current-scope replay
- regulation target materialization
- scoped-rules target-side quality hardening

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
- `internal_notice` 与 `regulations/*` 的 collection 语义边界已由 ADR-0035 冻结；`internal_notice` 不是 regulation collection，wrapper notice 不得直接进入 `regulations/*`

这意味着：

- 当前 repo 真相已经足够支撑“先把规章制度类通知收干净”的前半段
- 但还没有把“哪些内容应该从 `internal_notice` 继续提升为正式 `regulations/*` 语义 collection”正式落成 repo-level 实施面

## 当前代码与配置现实

结合当前代码和配置，已经成立的现实约束如下：

### 已有能力

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
  - 已支持 `attachment_ref` 分类、`reference_only` 过滤、`docx/xls/xlsx` 原生提取和 `pdf/image` OCR 候选分流
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
  - 已同时具备 `paddleocr_async_jobs` 和 `paddleocr_vl_service` 两种 provider mode
  - 默认 provider 已是 `paddleocr_async_jobs`
- `configs/ingestion/campus_notices/internal_notice/source-projections.v1.json`
  - 当前 `text_extractable_extensions` 已包含 `docx/xls/xlsx`
  - 当前 `ocr_required_extensions` 已包含 `pdf/png/jpg/jpeg/bmp/gif`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
  - 已明确 historical replay 当前应停在 pilot/verified，不继续 embedding / Qdrant

### 当前缺口

- 当前 repo 仍不接受把 `.doc` 静默当成已支持 Office 文本附件；它必须继续显式 fail-close 为 `unsupported_binary`
- `xls/xlsx` 当前已进入 canonical source projection path，但计划文档里仍残留“未完成支持”表述；这属于 planning truth 漂移，必须收口
- 当前 `.doc` 仍缺 canonical 的 legacy Office normalization lane；如果后续支持，必须以 worker-owned normalization/provenance contract 进入现有 source projection path
- 当前 `.doc` 的 fail-close 主要表现为 replay-time exception；是否要收口成 inventory-friendly terminal outcome，需要在同一条 non-auth downstream workstream 内单独裁决
- 当前后续实施重点不再是“有没有 target collection scaffold”，而是继续围绕 per-document `target_collection` 收口 downstream materialization / chunk acceptance / inventory truth

### 已新增的 repo-native 辅助能力

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`
  - 已提供只读 promotion manifest 生成器
  - 输入固定为 `internal_notice` canonical document + source-truth inventory
  - 输出固定为 `promote_candidate / hold_in_internal_notice / manual_review_required`
  - 当前只做分类、去重、metadata 缺口报告，不做 target collection 写入
  - 现已额外提供 local-only `candidate artifact` 导出能力
  - candidate artifact 会把 cleaned regulation body、promotion metadata 与 source provenance 固化成独立本地导出物，供后续 chunk-prep / review 消费
- `apps/ingestion-worker/src/campus_ingestion_worker/build_internal_notice_regulation_promotion_manifest.py`
  - 已提供 worker CLI，用于导出 `promotion-manifest.json` 与 `document-reports.jsonl`
- `apps/ingestion-worker/src/campus_ingestion_worker/export_internal_notice_regulation_candidate_artifacts.py`
  - 已提供 worker CLI，用于导出 local-only `promotion-candidate-manifest.json`、`candidate-documents.jsonl` 与每个 candidate 的 `canonical.md`

这几个缺口决定了：

- 下一步不能假装“`policy_regulation` replay 完就等于 regulation corpus 已经成立”
- 也不能把 `.doc` 静默当成“已经支持”

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

### 2.5 文档新旧更适合作为 metadata / ranking 信号，而不是 validity truth

Azure AI Search 官方文档把 freshness 建模为 scoring profile 中的可选打分函数，并把 filterable fields 作为显式索引字段能力，而不是把日期直接等同于“是否有效”：

- https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index

对本项目的直接含义是：

- `published_date`、`effective_date`、`revision_signal`、`supersession_evidence` 应是明确 metadata
- 校内规章制度不能因为“发布时间老”就默认降权成仅参考文本
- `暂行/试行` 也不能单独当作“失效”或“草案”判断；只有在正文出现明确的临时/过渡/失效语义时，才应排除出长期制度 collection

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

当前 repo 已冻结四层模型；实现仍按阶段推进。

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

这一层固定先做 `semantic owner` 解析，再做 promotion 判定。

第一版 owner 类型固定为：

- `notice_body`
  - parent notice 正文自身就是完整制度正文
- `attachment_document`
  - 制度正文在 attachment child document 中
- `file_release_document`
  - notice 只是发布/实施说明，真实正文在门户文件发布页或等价 owner 中

第一版显式 metadata 字段固定为：

- `semantic_owner_kind`
- `owner_source_missing_reason`

为避免 source-truth/import 在 attachment relation 缺失时把 owner 信号直接丢失，当前实现再固定补一层 source-level extension：

- `owner_expectation_count`
- `owner_expectations`

它们只保留“制度 owner 应存在但 relation 尚未恢复”的证据，不伪造 attachment rows；promotion 层优先消费这层显式 owner expectation，再决定是否进入 `manual_review_required`。

固定禁止：

- 用 `policy_regulation` family 直接替代 owner 判断
- 用 attachment lane 直接替代 owner 判断
- 在 owner 缺失时，把 wrapper notice body 直接 promote 成 regulation

这层的 architecture boundary 已由 ADR-0035 冻结；当前 repo-tracked implementation 仍待补齐。

### Layer 4: Regulations Collection

当前 repo-tracked target collection 固定为：

- `regulations/institutional_regulations`

命名理由：

- 它表达的是“机构正式制度正文”的长期语义 owner
- 它不绑定 `authenticated_notice_portal`
- 后续如果同一制度正文在 `official_web` 出现镜像或 canonical source，也可以进入同一个 collection，而不是再造 source-specific regulation collection

当前这个 target collection 在实现阶段固定先保持：

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
  - 征求意见稿、草案、讨论稿
- `annual_or_operational_scheme`
  - 强年限、强批次、强场景绑定的工作方案、实施方案、招生/推免/硕博连读类年度细则

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

### 第二层补充：哪些 regulation-like 文本需要 metadata 区分，而不是改走另一条 collection

当前已完成裁决的 regulation-like 文本，需要额外区分两类 `document_nature`：

- `annual_cycle_rule`
  - 年度/项目制招生、推免、硕博连读、英才计划实施细则
- `time_bound_operational_rule`
  - 暑假/寒假等时间窗口运营规则
  - 正文带显式过渡 / sunset 语义的临时运营规则

固定结论：

- 这两类不再因为“年度 / 过渡 / 时段性”就被排除出 `regulations/institutional_regulations`
- 它们仍然是规章制度正文，只是需要在 target-side metadata 中显式保留 `document_nature`
- 当前批次的导入目标固定统一为：
  - `regulations/institutional_regulations`
  - 保持 `offline_preparation + query_disabled`
- 后续如果真的要做更细的 retrieval / answering 策略，应基于 `document_nature`、`published_date`、`effective_date` 等 metadata 做 query-time/ranking-time 处理，而不是在 import gate 先拆 collection

### 当前 read-only promotion guardrails

在当前 repo-tracked 的 promotion manifest builder 中，第一版 guardrail 固定为：

- `notice_body` 只有在正文本体具备独立制度结构时，才允许进入 `promote_candidate`
- `关于发布/印发/实施...的通知` 这类 wrapper 标题，如果正文只是摘要、施行说明或附件指向，即使出现制度名，也继续保留在 `internal_notice`
- parent notice 正文如果明确出现 `附件：`、`参见《…》附件`、`信息门户-文件发布`、`自行下载参照执行` 一类 owner 指向信号，但当前 source-truth / child document 里还没有恢复出对应 owner source，则必须 fail-close 为 `manual_review_required`
- 文档发布时间老旧，不构成 standalone exclusion signal
- `暂行/试行` 不单独触发 `manual_review_required`
- 招生/推免/硕博连读/英才计划这类年度或项目制规则，当前可以进入 `promote_candidate`，但 target-side 必须带 `document_nature=annual_cycle_rule`
- 假期规定、正式运营前、临时医疗点等正文内出现明确临时/过渡语义的运营规则，当前可以进入 `promote_candidate`，但 target-side 必须带 `document_nature=time_bound_operational_rule`
- source-truth inventory 已声明存在 attachment projection，但当前 scope snapshot 缺少对应 child document 时，结果必须是 `manual_review_required`
- parent-body 候选继续保留 `source_parent_document_id` 和 `source_notice_ids` provenance；同时 target-side provenance 需要显式区分 `source_notice_document_id` 与 `semantic_owner_document_id`
- `source_attachment_ref_id/source_attachment_sha256` 只对 attachment-derived 候选强制要求

这组 guardrail 的目的不是完成最终 promotion contract，而是先防止两类已确认的错误：

- 把 donor body 中的 wrapper 摘要误升为 formal regulation
- 因为文档老旧或标题含 `暂行/试行` 就把真实仍在生效的校内制度错误排除
- 在输入快照不完整时给出看似确定的 hold/candidate 结论

### 为什么当前批次收口到单一 regulation collection

当前 repo 对 internal notice 派生制度的首要目标，是尽快把“已经能作为制度正文消费”的文本从 source-triage 层提升到 regulation owner 层。

因此当前正确动作是：

- 统一 materialize 到 `regulations/institutional_regulations`
- 用 `document_nature` 标记 `institutional_regulation / annual_cycle_rule / time_bound_operational_rule`
- 把 query-time 的细粒度分流、比较、时效性判断后置，不在当前 import gate 过早拆 collection

这里新增一条 operator 约束：

- 不直接把历史 `local-smoke/object-store` 根目录当作 acceptance 输出根
- local-only acceptance 应复制 source snapshot 后在 isolated root 中写入 target-side preview artifacts

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

当前建议不要做的错误动作：

- 不把 `.doc` 静默当成 `.docx`
- 不在 repo 内手写 `.doc` 二进制 parser
- 不因为 `.doc` 当前未支持，就反向把整个 `policy_regulation` promotion 搁置
- 不把已经支持的 `xls/xlsx` 再写回“未完成支持”口径

正确做法是：

- 当前 canonical promotion 输入继续按已落地路径消费 `docx/pdf/xls/xlsx`
- `.doc` 单独保持为 legacy Office gap
- 后续在同一条 workstream 内新增 worker-owned normalization/provenance 能力，再决定是否扩大 `.doc` promotion 面

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

当前需要新增一条 document-level promotion contract，而不是改写 source-truth contract。

### 需新增的 repo-tracked config

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
- `source_notice_document_id`
- `source_parent_document_id`
- `source_attachment_document_id`
- `source_attachment_ref_id`
- `source_attachment_sha256`
- `semantic_owner_document_id`
- `source_notice_release_time`
- `regulation_title_normalized`
- `issuing_org`
- `effective_date`
- `is_draft`
- `revision_signal`
- `supersedes_candidate_keys`

### Local-Only Candidate Artifact Contract

在真正允许写入 `regulations/*` 之前，repo 现在先固定一层 local-only candidate artifact contract。

这层的职责是：

- 把 `promote_candidate` 从“manifest 里的一个判断结果”提升成可审阅、可复用的本地候选件
- 把 parent notice promotion-side cleanup 之后的制度正文固化下来，不再让后续 chunk-prep 继续直接读取 source-triage notice 正文
- 在不触发 Postgres / release / embedding / Qdrant side effect 的前提下，给后续 chunk-prep 和人工验收提供稳定输入

第一版 contract 固定导出：

- `promotion-candidate-manifest.json`
  - summary、scope、selected ids、candidate refs
- `candidate-documents.jsonl`
  - 每个 candidate 的 promotion metadata、provenance、quality gates、body hash
  - 额外保留后续 local-only target-side chunk prep 必需的 runtime 元数据：
    - `source_uri`
    - `entitlement_groups`
    - `visibility_scope`
    - `visibility_level`
    - `embedding_model`
    - `is_current`
- `candidates/<slug>--<candidate_id>/canonical.md`
  - local-only canonical candidate markdown
  - front matter 保留：
    - `candidate_id`
    - `source_document_id`
    - `source_kind`
    - `promotion_class`
    - `source_notice_release_time`
    - `source_notice_document_id`
    - `source_parent_document_id`
    - `source_attachment_document_id`
    - `source_attachment_ref_id`
    - `source_attachment_sha256`
    - `semantic_owner_document_id`
    - `issuing_org`
    - `effective_date`
    - `revision_signal`
  - 正文固定为：
    - `# regulation_title_normalized`
    - promotion-side cleaned regulation body

这层明确不是：

- final regulation `document_id/version_id`
- target collection write
- object-store publish contract
- release candidate

之所以要先落这一层，是因为外部官方实践都强调“父级 metadata/provenance 要显式映射到后续消费单元”，而不是在后置阶段再猜：

- Azure AI Search index projections：
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-define-index-projections>
- Azure AI Search structure-aware chunking：
  - <https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents>
- Google Cloud Document AI custom splitter：
  - <https://cloud.google.com/document-ai/docs/custom-splitter>

对本项目的直接含义是：

- source-truth provenance 必须先显式保留到 candidate artifact
- cleaned body 必须先固化，再进入后续 chunk-prep
- regulation promotion 不能把“分类判断”“正文清洗”“chunk 输入”混成一次性内存结果
- parent notice / attachment child / promoted regulation 必须继续保留为三层不同对象；notice provenance 只下沉为 metadata，不回混成 regulation 正文

### Local-Only Candidate Chunk Prep Contract

在 candidate artifact 之后，repo 现在再固定一层 local-only target-side `chunk prep / quality` contract。

这层的职责是：

- 把 candidate artifact 投影成 `regulations/institutional_regulations` 语义下的 target-side `document-units.jsonl`
- 使用目标 collection 的 `chunk-profile.json` 生成本地 `chunks.jsonl` 预览
- 产出不带任何 release/index side effect 的 machine-readable validation summary

第一版 local-only chunk-prep 固定导出：

- `chunk-prep-manifest.json`
- `validation-summary.json`
- `document-reports.jsonl`
- `prepared-candidates/<slug>--<candidate_id>/document-units.jsonl`
- `prepared-candidates/<slug>--<candidate_id>/chunks.jsonl`

这层明确不是：

- target collection write
- release candidate
- serving alias publish
- embedding/index publish

当前真实样本 `187233 / 中央民族大学采购工作管理办法` 的 rebuilt local-only chunk prep 与后续 structure-aware rerun 已确认：

- hard gate 全部通过：
  - `missing_title_chunk_count = 0`
  - `missing_contextualization_count = 0`
  - `missing_projection_metadata_count = 0`
  - `wrapper_notice_leak_chunk_count = 0`
  - `front_matter_leak_chunk_count = 0`
- structure-aware rerun 现已把 target-side short fragment 收口到：
  - `total_unit_count = 16`
  - `total_chunk_count = 6`
  - `short_body_chunk_count = 0`
  - `quality_posture = ready_for_target_materialization`

这里的直接设计含义是：

- local-only chunk prep 现在可以作为 promotion 之后、materialization 之前的固定验收层
- `institutional_regulations` 当前对已通过 promotion gate 的 candidate，已经具备可接受的 target-side chunk quality
- 剩余前向工作不再是 target chunk tuning，而是 promotion admission/routing review，尤其是 Cohort A 中仍停在 `manual_review_required` 的 `10` 条 notice

### Rebuilt Inventory Caveat

真实样本还确认了一条 operator 级事实：

- `local-smoke` 目录里的历史 `source-truth-inventory.json` 可能仍保留旧 metadata
- 对 `187233`，旧 inventory 会让 `source_notice_release_time = null`
- 当前 local-only candidate chunk-prep 已把 `source_notice_release_time` 提升为 hard gate；旧 inventory 导出的 candidate 会在 validation summary 中被显式卡住
- 因此，后续若继续使用历史 local-smoke 快照做 bounded replay / candidate export，必须优先消费 rebuilt inventory entry，而不是默认信任旧 inventory dump

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

落地时固定采用以下目标路径前缀：

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

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
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

当前 repo 结果（2026-04-11）：

- config scaffold、promotion routing 与 target collection contract 已落地
- source-side read-only manifest builder 已可稳定产出 `candidate / hold / manual_review_required`
- target-side materialization contract 也已进入 repo-owned code truth，但仍未进入 chunk preparation / release

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

当前 repo 结果（2026-04-11）：

- bounded target materialization 已落地到 `regulations/institutional_regulations`
- target `document_id` 现由 `regulation_work_title + issuing_org + semantic scope` 派生，而不是 `notice_id`
- duplicate notice provenance 已在 target metadata 中聚合
- current implementation 仍显式停在 `offline_preparation`：没有 target chunk prep、embedding、Qdrant write、release 或 alias publish

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

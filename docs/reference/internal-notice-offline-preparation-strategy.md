---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-10
---

# Internal Notice Offline Preparation Strategy

## 文档边界

本文冻结 `campus_notices/internal_notice` 在 `source-truth replay -> document build -> split / cleanup / chunk -> verified chunk preparation` 这一段的 collection-specific strategy。

它回答的是：

- parent notice 与 attachment child document 应如何分 lane 处理
- 哪些内容属于 `chunk preparation`，哪些内容属于后续 `index release`
- 当前 runtime 默认预算与长期 collection strategy 是什么关系
- `internal_notice` 的 preparation artifacts 应落在哪个对象存储前缀

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的 source-channel supporting architecture
- `docs/architecture/authenticated-notice-source-truth-contract.md` 的 source-truth schema
- `docs/architecture/data-plane-architecture.md` 的 repo 级 shared data-plane rules
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md` 的 attachment typed routing governance
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md` 的 PDF 默认消费路径决策
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md` 的 notice-family admission decision
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md` 的 regulation owner boundary
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 的质量验收规则
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 operator workflow
- `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md` 的 donor normalization / local smoke workflow

## 当前 Collection 姿态

- `source_channel=authenticated_notice_portal`
- `corpus/collection=campus_notices/internal_notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- collection 默认按 `restricted institutional document` rollout 处理

当前语料特征固定按以下判断建模：

- notice 正文整体较干净，主问题不是 parent notice body
- 历史噪声主要集中在 attachments，尤其图片 OCR、脏表格和装饰性静态资源
- 因此 collection 默认优化目标是先保住 parent notice body 质量，而不是因为 attachment outlier 全局缩小分块或全局劣化正文策略

## Collection Semantic Boundary

`campus_notices/internal_notice` 当前固定是：

- authenticated notice 的 source-channel-first triage collection
- restricted replay / preparation / quality-evidence layer

它不是：

- formal regulation collection
- `regulations/*` 的过渡别名

因此固定规则为：

- wrapper notice、attachment relation truth、`manual_review_required`、`reference_only`、`no_extractable_text` 继续留在 `internal_notice`
- 本 collection 内的 verified replay / chunk preparation，只证明 source-channel triage 质量，不等于 regulation corpus 已成立
- 如果某份 notice 正文或 attachment 正文已经达到独立制度消费质量，必须经过单独 promotion boundary 再进入 `regulations/*`

当前 repo 级 promotion boundary 见：

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`

## Notice-Family Admission

`internal_notice` 当前允许维护一层独立于 attachment risk 的 notice-family admission。

这层分类固定属于：

- inventory / replay / operator read model
- bounded pilot 选样与优先级控制
- 处理顺序收口

它不属于：

- source-truth contract
- attachment typed routing
- parent/child document identity

当前 accepted decision 见：

- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json`

固定规则：

- source-truth 继续尽量全量保留 notice
- replay / preparation admission 可以按 notice family 控制优先级
- 当前 `priority_now` family 固定为 `policy_regulation`
- `event_activity`、`lecture_publicity` 默认延后，不与规章制度类争抢第一批 replay / OCR / 验收预算
- portal `notice_type` 只作为 coarse prior，不是最终 family truth
- repo-local live collector 当前只启用 `5 / 办公通知` 做 bounded live execution；这不影响 donor historical bundle 的全量 family analysis

live taxonomy 与样本依据固定见：

- `docs/reference/authenticated-notice-portal-live-observations.md`

这层分类与 notice risk profile 是正交维度：

- notice family 回答“这条 notice 现在值不值得优先处理”
- notice risk 回答“这条 notice 的 attachment lane 风险有多高”

固定禁止：

- 用 notice family 替代 attachment lane 决策
- 用 attachment risk 替代 notice family admission
- 因某个 family 暂缓处理，就改写 source-truth contract 或 attachment routing contract

## Historical Donor Intake Order

`internal_notice` 当前处理 `rag-data` donor snapshot 时，固定按以下顺序推进：

1. 先用 live 登录态确认 portal taxonomy、collector notice-type policy 与样本事实
2. 再对 donor bundle 做 repo-tracked notice-family analysis
3. 第一批 donor processing 只推进 `policy_regulation`
4. `operational_procedure`、`roster_publication` 作为后续批次
5. `event_activity`、`lecture_publicity` 默认延后

这里的 donor intake order 只影响 replay / preparation admission，不改写 source-truth 全量吸纳原则。

## Notice Risk Profile

`internal_notice` 当前允许维护一层 notice-level 派生风险画像，但它只属于 inventory / replay / operator read model，不属于 source-truth contract。

当前 Phase 1 固定字段：

- `notice_risk_label`
- `attachment_mix_score`
- `has_text_table_attachment`
- `has_spatial_attachment`
- `has_reference_only_attachment`

当前标签集固定为：

- `body_only`
- `body_with_reference_only_attachments`
- `body_with_text_attachments`
- `body_with_spatial_attachments`
- `mixed_high_risk`

固定用途：

- pilot 抽样覆盖
- batch planning / operator triage
- quality evidence 分桶

validator / sample export 的固定读取顺序：

- `verified_closeout_run` 或 closeout-backed manifest：优先读取该 run 的 frozen inventory
- `current_scope` 或普通 preparation manifest：读取当前 source-truth inventory
- 不允许只根据当前已 materialize 的 parent / child documents 重新猜测 risk profile

这样做的原因固定为：

- `manual_review_required`
- `reference_only`

这两类 attachment 可能不会 materialize 成 child document；如果 validator 只看当前 chunk documents，会把真正高风险 notice 错判成低风险或 `body_only`

固定禁止：

- 不用 notice 标签直接决定 attachment 的 extraction lane
- 不把 notice 标签回写为 source-truth contract 字段
- 不因为 notice 被打成高风险，就整体降级 parent notice body 的 cleanup / chunk 策略

## Accepted Lane Model

`internal_notice` 的离线 preparation 固定按三类 document lane + terminal outcomes 处理：

- `notice_body`
- `attachment_text_extractable`
- `attachment_ocr_required`
- terminal outcomes: `reference_only` / `manual_review_required` / `no_extractable_text` / `unsupported_binary`

这些 lane / outcomes 都建立在既有“两层 projection”之上：

- parent notice document 只承载 notice 正文与正文结构单元
- attachment refs 留在 source-truth relation truth
- attachments 如需进入 document/chunk pipeline，必须先 materialize 为 repo-owned child documents

## Parent Notice Lane

parent notice lane 的固定规则：

- 只消费 notice 正文结构单元
- `attachment_ref` 结构单元必须显式跳过
- 默认按正文结构做 `structure-first` 聚合，保留 heading / section anchor
- 不把 attachment OCR、脏表格或 decorative asset 的问题反向投射为 parent notice 的全局分块策略
- notice body 中偶发的异常表格或噪声块，只能作为局部异常处理，不得驱动整个 collection 缩小 chunk

这条 lane 的目标是让内部通知正文保持较高语义完整度，而不是把所有 notice 正文预先切成更小的均匀窗口。

## Attachment Text-Extractable Lane

`attachment_text_extractable` 的固定规则：

- 先完成确定性的 native text extraction，再进入 cleanup / chunk
- chunking 以 attachment 自身结构为准，不复用 parent notice body 的 anchor 和分块策略
- 保留 page / section / heading 等 attachment 自身的定位线索
- 不把 attachment 文本重新拼回 parent notice 的正文 chunk
- 当前默认只覆盖可稳定原生解析的 Office 文本附件，至少包括 `docx`
- `pdf` 不因为带 text layer 就默认进入这条 lane

这条 lane 面向可稳定提取文本的 Office 文本附件，目标是保住附件本体结构，而不是把附件降格为 notice 正文的附属片段。

## Attachment OCR Lane

`attachment_ocr_required` 的固定规则：

- 先走 OCR / layout-aware extraction，再进入 cleanup / chunk
- 表格、图片区块、段落区块的边界应优先保留，不以 parent notice 的 chunk 预算直接套用
- OCR lane 的异常处理只在 lane 内收口，不得反向降低 `notice_body` lane 的默认质量
- 规章制度 / 手册类 `pdf` 默认走这条 lane；云端 async OCR 结果是 canonical extraction path，native PDF extraction 最多只作为 diagnostics / quality probe
- materialized OCR child document 的 first-class derived artifacts 固定包含：provider response、`layout-elements.jsonl`、canonical markdown、`document-units.jsonl`
- OCR child document 的结构化单元固定优先表达为 `attachment_title`、`section_text`、`table`、`table_unit`，而不是把整份附件压平成单一 `attachment_body`
- provider 返回的 raw html / table markup 只允许停留在 lane-local `layout-elements.jsonl`，不得直接进入 canonical markdown 或最终 chunk text

这条 lane 的一等结果形态只有两类：

- `materialized_document`
- `no_extractable_text`

其中：

- 有非空标准化文本时，必须 materialize child document
- OCR 结果为空时，不得伪造空 child document，也不得把整条 notice 视为 source-truth 损坏

额外固定边界：

- `attachment_ocr_required` 当前覆盖两类输入：
  - policy / handbook / procedure 等文档型 `pdf`
  - 以线性文本、表格、电话、营业时间为主的图片
- 校园导览图、位置图、楼宇分区图这类空间关系主导的内联图片，不进入当前 OCR lane
- 这类图片固定进入 `manual_review_required` terminal outcome，等待后续 spatial/manual lane，而不是把零散 OCR 碎字送进可检索 truth

## Reference-Only And Failure Outcomes

以下结果不进入可检索 document/chunk truth：

- `reference_only`
- `manual_review_required`
- `no_extractable_text`

其中：

- `reference_only` 继续只保留 source-truth relation truth
- `manual_review_required` 继续保留 source-truth relation truth，并显式保留 `review_reason`
- `no_extractable_text` 必须作为 attachment outcome 被显式记录，供 verifier / operator 审计

以下结果直接 fast-fail：

- `unsupported_binary`

固定禁止：

- 不把 decorative asset 误判成 OCR candidate 后再静默降级
- 不把 `unsupported_binary` 伪装成空文档或 reference-only 成功

## Current Runtime Defaults vs Long-Term Strategy

当前 repo-tracked `chunk-profile.json` 仍保留一组 generic runtime defaults：

- `chunk_size=220`
- `max_chunk_size=320`
- `chunk_overlap=32`
- `min_chunk_size=32`

这组数值当前只应解读为：

- `internal_notice` 的 chunk-preparation admission baseline
- generic structured-unit pipeline 的运行时默认值

它不应被误读为：

- `internal_notice` 已经完成 lane-specific semantic chunking
- parent notice 与 attachments 共享同一长期最优策略
- 只要继续调这组全局预算，就能替代 collection-specific lane design

因此本 collection 的 accepted direction 固定为：

- runtime default 可以暂时存在
- 但长期 truth 是 lane-specific semantic strategy，而不是单一 generic budget

## Chunk Preparation Boundary

`chunk preparation` 在 `internal_notice` 上固定只负责：

- 读取显式选定的 parent / child documents
- 常规 release-prep 路径读取 registry current truth
- bounded pilot / pre-promote 路径允许读取 verified closeout run 的 staged document truth
- 执行 split / cleanup / chunk
- 生成 validation summary 与 document reports
- 产出一个可被后续 release gate 验证的 preparation manifest

`chunk preparation` 明确不负责：

- embedding
- Qdrant upsert
- alias publish
- attachment extraction / cleanup / chunk quality acceptance

对 `internal_notice`，`chunk preparation` 与 `index release` 必须是两个显式阶段，不能再把它们揉成单个 black-box 命令。

额外固定规则：

- `prepare_registry_scope_chunks` 的结构通过不等于 `internal_notice` 质量通过
- 质量验收固定由 `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 定义

## Preparation Artifacts

`internal_notice` 的 preparation truth 固定落在 operations prefix，而不是 release prefix：

- `campus_notices/operations/registry-scope-chunk-preparation/{preparation_run_id}/internal_notice/chunk-preparation.json`
- `campus_notices/operations/registry-scope-chunk-preparation/{preparation_run_id}/internal_notice/validation-summary.json`
- `campus_notices/operations/registry-scope-chunk-preparation/{preparation_run_id}/internal_notice/document-reports.jsonl`

其中：

- `chunk-preparation.json` 是这次 selected document set 的 frozen preparation truth
- 当 preparation 来源是 verified closeout run 时，manifest 仍冻结 final canonical document identity / final object keys；运行时读取可以来自 staged `document-units.jsonl`
- `validation-summary.json` 记录这次 preparation 的 admission verdict
- `document-reports.jsonl` 用于按 document 审计失败和异常

attachment child document 的 derived artifacts 继续落在 documents prefix，但固定补充以下路径规则：

- artifact directory 必须由完整 `document_id` 派生稳定 identity，而不是只看最后一级附件 ref
- 当 `document_id` 较长时，目录短标签可以退化成稳定 hash；但不同 notice 下的同名 attachment ref 不得落进同一路径
- 这条规则用于避免 `notice_attachment:<site>:<notice_id>:attachment-0001` 这类 historical corpus 在 derived bucket 中发生 key collision

固定禁止：

- 把 preparation artifacts 写进 `campus_notices/releases/...`
- 把 preparation 结果当成已经完成 embedding / indexing 的 release truth

## Release Gate

`internal_notice` 的后续 `index release` 固定受 preparation gate 约束：

- release 必须显式引用一个成功的 `preparation_run_id`
- release 前必须验证 preparation manifest 与 current registry scope hash 一致
- verified closeout run 生成的 `preparation_run_id` 在 promote 前可以先用于 chunk-quality 验收；只有 promote 后 current scope 与 manifest hash 对齐，才可作为 release gate 输入
- release 与 preparation 之间不存在“默认自动继续”的隐式跳转

因此对当前 collection posture，最自然的可验证停点是：

- verified chunk preparation

而不是：

- source-truth replay 完成就视为可以直接写 embedding / Qdrant

## Forbidden Shapes

- 不把 attachment 文本重新并回 parent notice body
- 不因为 attachment lane 的脏表格或 OCR 噪声，全局缩小 parent notice chunk
- 不把 `220/320/32/32` 这组 generic runtime defaults 当成最终 collection strategy
- 不让 `chunk preparation` 产生 embedding / Qdrant side effects
- 不跳过 verified preparation，直接从 replay 进入 index release

## 相关稳定文档

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/reference/authenticated-notice-historical-donor-intake-evidence.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `configs/ingestion/campus_notices/internal_notice/README.md`

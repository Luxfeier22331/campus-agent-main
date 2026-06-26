---
doc_type: reference
truth_scope: data
owner_boundary: domains/authenticated-notice
status: historical
created: 2026-04-06
updated: 2026-04-27
---
# Internal Notice Offline Preparation Strategy

## 文档边界

本文冻结 `campus_notices/internal_notice` 在

`source-truth replay -> document build -> split / cleanup / chunk -> verified
chunk preparation`

这一段的 collection-specific strategy。

它负责：

- collection semantic boundary
- notice-family / notice-risk 的策略语义
- parent/child lane model
- chunk preparation 与后续 release 的边界

它不负责：

- operator 执行步骤
- auth-window donor / capture 细节
- regulation target materialization 实施顺序

相关文档：

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`

## Collection Posture

当前 collection posture 固定为：

- `source_channel=authenticated_notice_portal`
- `corpus/collection=campus_notices/internal_notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- `restricted institutional document` rollout

固定解释：

- `internal_notice` 是 source-channel-first triage collection
- 它不是 formal regulation collection
- verified replay / chunk preparation 只证明 source-channel triage 质量，不等于
  regulation corpus 已成立
- future notice runtime 如需消费 `internal_notice`，也只能把它当作 restricted notice source
  family；这不自动打开 query-serving，也不把它改写成 public notice surface
- future restricted notice runtime query seam 只能读取 projected notice metadata /
  canonical body truth
- query path 不得直接扫描 `internal_notice` raw/source-truth bundle、chunk preparation
  artifacts 或 query-disabled retrieval alias

## Notice-Family Admission Contract

`internal_notice` 允许维护独立于 attachment risk 的 notice-family admission。

这层分类只属于：

- inventory / replay / operator read model
- batch planning / pilot sampling
- 处理顺序收口

它不属于：

- source-truth contract
- attachment typed routing
- parent / child document identity

固定要求：

- family truth 继续由 repo-tracked config 与 inventory owner 持有
- replay / preparation priority 可以按 family 控制
- 具体优先级与 frontier 变化不在本文落日期状态，统一回到 config、inventory 与 `.planning`

## Notice Risk Profile Contract

`internal_notice` 允许维护 notice-level risk profile，但它只属于 inventory / replay /
operator read model。

当前稳定字段包括：

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

固定要求：

- validator / sample export 优先读取 frozen inventory
- 不允许只根据当前 materialized document 重新猜 risk profile
- `multimodal_processing_required` 与 `reference_only` attachment 不因“没有 child document”而从
  risk profile 中消失

## Accepted Lane Model

`internal_notice` 的离线 preparation 固定按三类 document lane + terminal outcomes 处理：

- `notice_body`
- `attachment_text_extractable`
- `attachment_ocr_required`
- terminal outcomes:
  - `reference_only`
  - `multimodal_processing_required`
  - `no_extractable_text`
  - `unsupported_binary`

这些 lane / outcomes 都建立在两层 projection 上：

- parent notice document 只承载 notice 正文
- attachment refs 留在 source-truth relation truth
- attachments 如需进入 document/chunk pipeline，必须先 materialize 成 repo-owned child
  documents

## Parent Notice Lane

固定规则：

- 只消费 notice 正文结构单元
- `attachment_ref` 结构单元必须显式跳过
- 默认按正文结构做 `structure-first` 聚合
- attachment OCR / 表格 / 装饰资源问题不得反向驱动 parent lane 全局降级

## Attachment Text-Extractable Lane

固定规则：

- 先完成确定性的 native text extraction，再进入 cleanup / chunk
- chunking 以 attachment 自身结构为准
- 不把 attachment 文本重新拼回 parent notice 正文 chunk
- 当前只覆盖 canonical accepted 的 Office / text-extractable family

## Attachment OCR Lane

固定规则：

- `pdf` 默认按 `ocr_required` 处理，不因 text layer 自动回到 text-extractable lane
- OCR lane 的 provider routing 由 shared OCR owner 决定，不由本 collection 文档重新定义
- `multimodal_processing_required` / `reference_only` 继续作为 terminal
  outcome，而不是 OCR lane 失败后的隐式补救

## Preparation / Release Boundary

固定要求：

- `chunk preparation` 与 `index release` 必须继续分离
- verified preparation 只证明：
  - canonical markdown
  - document-units
  - chunk artifacts
  - preparation validation
- verified preparation 不自动推出：
  - embedding
  - Qdrant write
  - release / alias publish

## Consumer Admission Decision Matrix

`internal_notice` 的 consumer admission 目标是把 source-truth 留档、projection
候选、read model 与 typed materializer 输入分开。它运行在 import dry-run / source-truth
inventory 之后、projection/read-model/materializer 写入之前。

第一版 decision matrix 固定如下：

- 正文非空、notice family 属于高价值信息查询、无 unresolved owner gap：
  `target_surface=notice_level_query`，
  `consumption_status=retained_for_notice_query`，写入 consumption
  projection + notice read model
- 采购、招标、成交、公示等历史查询类通知：
  `target_surface=procurement_notice_history`，
  `consumption_status=retained_for_notice_query`，写入 consumption
  projection；是否生成专用 read model 由后续 target owner 冻结
- 服务开放、停运、临时调整、可用性变化：
  `target_surface=campus_services/service_status_candidate`，
  `consumption_status=candidate_for_typed_materialization`，写入 consumption
  projection；typed service materializer 后续消费
- 办理指南、预约入口、领取方式、使用约束：
  `target_surface=campus_services/special_service_candidate`，
  `consumption_status=candidate_for_typed_materialization`，写入 consumption
  projection；`service_guide_lookup` 只读记录后续生成
- 稳定部门电话、办公地址、办公时间变化：
  `target_surface=campus_services/stable_contact_candidate`，
  `consumption_status=candidate_for_typed_materialization`，写入 consumption
  projection；contact directory owner 后续消费
- 可机器处理的视觉/非线性缺口，且 notice 价值足以处理：
  `target_surface=multimodal_processing_candidate`，
  `consumption_status=pending_multimodal_processing`，写入 consumption
  projection + multimodal attempt lifecycle
- 空正文、低价值短生命周期宣传、owner gap 无法恢复、unsupported route：
  `target_surface=unsupported`，`consumption_status=no_adoption`，只写入
  consumption projection

固定约束：

- `candidate_for_typed_materialization` 不打开 runtime lookup；它只给后续 typed
  materializer 提供稳定输入集合
- notice read model 只能消费 `target_surface=notice_level_query` 且
  `consumption_status=retained_for_notice_query` 的 rows
- service guide / contact / transport 等 typed materializer 只读 projection truth，不得在
  query time 或 materialization time 回扫 source-truth inventory 扩张范围
- `unsupported/no_adoption` 也必须落 reason code，避免再次被历史批量流程无差别捞起
- 任何需要 owner recovery、attachment recovery 或 multimodal processing 的 notice，都不得在
  完成对应 lane 前进入 ready read model

## Consumer Admission Manifest And Gate

每次 consumer admission 必须生成 manifest 与 gate report。manifest 是本次 admitted
scope 的唯一写入授权；gate report 是写入前的阻断证据。

manifest 必须记录：

- selection source、selection path、selection sha256
- policy version 与 routing taxonomy version
- selected notice ids 与每条 notice 的 decision record
- target surface / consumption status / reason code
- body quality、attachment ref、owner expectation、reference-only、unsupported、
  pending multimodal 计数
- scope write mode，尤其是 `replace_scope` 是否被显式允许

gate 必须阻断：

- 没有 manifest 的 full-scope / historical materialization
- manifest 与 bundle/source-truth inventory 的 notice ids 不一致
- 未显式声明却试图 replace scope
- 空正文、owner gap、unsupported binary、pending multimodal 比例超过 policy 阈值
- read model rebuild 试图消费非 `notice_level_query/retained_for_notice_query` rows
- typed materializer 试图消费非自身 `target_surface` rows

gate 通过只表示本批可以进入对应 offline write target，不表示：

- `internal_notice` 已经打开 query-serving
- chatbot / panel 已经能直接查询该 surface
- typed campus-services runtime 已经完成
- index release / alias publish 已经完成

### Consumer Admission Operator Sequence

下游 consumer materialization 的安全顺序固定为：

1. 先运行 authenticated notice import dry-run / plan，确认 bundle 与写入计划：

   ```bash
   uv run --all-packages python \
     -m campus_ingestion_worker.import_authenticated_notice_export \
     --bundle-path <notices-bundle.json> \
     --manifest-path <export-manifest.json> \
     --site-id muc_internal_portal \
     --source-home-url <portal-home-url> \
     --mode plan
   ```

2. 从 dry-run bundle 或已选择的 source-truth inventory 生成 consumer admission
   manifest：

   ```bash
   m=campus_ingestion_worker.build_internal_notice_consumer_admission_manifest
   uv run --all-packages python -m "$m" \
     --bundle-path <notices-bundle.json> \
     --output-path <consumer-admission-manifest.json> \
     --admission-run-id <consumer-admission-run-id> \
     --selection-path <notices-bundle.json> \
     --site-id muc_internal_portal
   ```

3. 在任何 read-model、projection、typed candidate 或 multimodal 写入前，单独跑
   release gate；如果 verdict 为 `block`，命令必须非零退出：

   ```bash
   uv run --all-packages python \
     -m campus_ingestion_worker.check_internal_notice_consumer_admission_gate \
     --manifest-path <consumer-admission-manifest.json> \
     --operation projection-rebuild
   ```

4. 只有 gate 通过后，才允许 bounded materialization。import 路径必须显式携带
   consumer manifest。manifest 只负责证明当前 bundle / selection 已获准进入下游，
   不得把本次 bundle / selection 之外的 notice id 扩张进写入范围：

   ```bash
   uv run --all-packages python \
     -m campus_ingestion_worker.import_authenticated_notice_export \
     --bundle-path <notices-bundle.json> \
     --manifest-path <export-manifest.json> \
     --consumer-admission-manifest-path <consumer-admission-manifest.json> \
     --site-id muc_internal_portal \
     --source-home-url <portal-home-url> \
     --mode admit-and-materialize
   ```

projection / read-model / repair / multimodal drain 的 operator CLI 也必须携带
`--consumer-admission-manifest-path`。缺少 manifest 时 fail closed；manifest 之外的
notice id 不得通过重新扫描 source-truth inventory 扩张 downstream scope。

## Related Docs

- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`

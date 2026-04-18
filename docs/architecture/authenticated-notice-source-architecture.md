---
doc_type: architecture
status: active
created: 2026-04-03
updated: 2026-04-19
---

# Authenticated Notice Source Architecture

## 文档边界

本文冻结 `authenticated_notice_portal` source channel 的 repo-level supporting architecture。

它回答的是：

- 登录态内部通知采集器、对象存储、ingestion/data plane 如何分层
- 这条 source channel 与 `official_web`、restricted document rollout 分别是什么关系
- collector runtime、bootstrap importer 与后续 control-plane 各自属于谁

它不负责：

- 当前 merged truth 已经实现到哪一步
- 具体站点登录方式、抓取脚本或 Playwright 细节
- 某个下游 collection 的 chunking / retrieval / operator UI 细节

## Core Topology

第一阶段接受的接入拓扑固定为：

`external scheduler -> authenticated notice collector -> object storage + typed bootstrap artifacts -> ingestion-worker -> document/chunk/index`

其中 `authenticated notice collector` 当前允许承接两条 authenticated portal surface：

- `notice`
  - `/comsys-portal-notice-web/*`
- `file_release`
  - `/comsys-prompt-portlet-web/*`

关键边界：

- collector 负责登录态复用、list/detail 抓取、正文/链接/附件增强、对象上传与 typed artifact 输出
- `apps/ingestion-worker` 负责 bootstrap import、source-truth 重建、document/chunk/index 写入
- `packages/ingestion-core` 负责 source-truth contract、projection、registry 与 release 语义
- 第一阶段不要求先落 `app-api` control plane

## Source Channel Rules

- `authenticated_notice_portal` 是一级 `source_channel`，不是 `official_web` 的特殊站点
- 这条 source channel 面向“登录态、机构内部通知”这类受限知识源
- downstream serving / retrieval 继续只消费 document / chunk / registry truth
- 当前 bootstrap seam 可以消费 typed export/import artifacts，但这些 artifacts 不是长期 canonical truth

## Live Notice-Type Policy

- collector runtime 可以按执行安全性只启用 portal notice types 的一个子集
- 当前 repo-tracked live 默认 config 只启用 `5 / 办公通知`
- 这个 live config 只表达 bounded runtime policy，不表达 source-channel scope，也不表达 notice-family truth
- 更宽的 portal taxonomy 与 live 样本事实固定记录在 `docs/reference/authenticated-notice-portal-live-observations.md`
- historical donor absorption 不得因为 live config 当前较窄，就反向改写 source-truth 范围

## Source Unit

这条 source channel 当前包含两个不同的 source surface：

- `notice`
- `file_release`

其中当前已经冻结 canonical source-truth contract 的 source unit 只有：

- `notice`

`file_release` 当前仍是 collector-owned typed export slice。它必须和 `notice` 分开采集、分开导出，不能把文件发布记录伪装成 notice，也不能把 notice 正文里“见信息门户-文件发布”的提示误当作 notice 自身正文。

当前 collector-owned export shape、bundle/manifest 字段，以及 `reference_only` / `object_store_write` 的含义，固定记录在：

- `docs/reference/authenticated-notice-file-release-export-contract.md`

对 `notice` surface，canonical source unit 仍固定为：

- `notice`

不是：

- public web page
- crawl frontier URL
- collector 本地 SQLite row
- 本地文件路径

原因：

- 内部通知系统的稳定资源身份首先由 notice identity 决定
- list/detail API、正文 HTML、链接观测与附件关系都应围绕同一条 notice 归并

## Contract Split

- source-channel 运行边界：本文
- source-truth schema：`docs/architecture/authenticated-notice-source-truth-contract.md`
- shared file asset loader：`docs/architecture/file-asset-loader-architecture.md`
- `file_release` collector-owned export contract：`docs/reference/authenticated-notice-file-release-export-contract.md`
- shared data-plane 不变量：`docs/architecture/data-plane-architecture.md`
- `internal_notice` collection-specific offline preparation strategy：`docs/reference/internal-notice-offline-preparation-strategy.md`
- restricted document center artifact contract：`docs/reference/restricted-document-center-artifact-contract.md`
- authenticated document center / regulation 分层决策：`docs/decisions/adr-0041-authenticated-document-center-and-regulation-layer-split.md`
- restricted document authorization：`docs/architecture/identity-and-authorization-architecture.md`

## Collector Runtime Ownership

collector runtime 的第一 owner 固定为 repo 内独立 `apps/*` runtime shell。

推荐落点：

- `apps/authenticated-notice-collector`

它负责：

- 登录态 bootstrap / refresh
- source-specific list/detail fetch
- `file_release` list/detail/file-url fetch
- notice-level normalize / enrich
- 附件对象上传
- typed artifact 输出

它不负责：

- document registry
- chunking / embedding / index release
- retrieval serving truth
- restricted authorization projection 解释

## Attachment Handling Boundary

对 authenticated notice source channel，附件对象的长期 owner split 固定如下：

- collector / source-truth layer
  - 负责附件发现、对象上传、attachment refs 与 source-level relation truth
- shared file asset loader
  - 负责 admitted file-like attachment 的 normalization / extraction / terminal outcome
- collection-specific downstream
  - 决定哪些 extracted attachment child document 继续进入 cleanup / chunk / promotion

固定规则：

- attachment relation truth 不因为 shared loader 接入而离开 `notice` source-truth
- `doc/xls -> docx/xlsx` 的 conversion service、OOXML deterministic parse、PDF/image parsing lane 都不属于 collector 私有 contract
- 如果 attachment 最终只落到 `reference_only`、`manual_review_required` 或 `unsupported_binary`，collector 仍只持有 source relation truth，不伪造 child document

## Bootstrap Import Ownership

在 collector 正式迁入 monorepo 并直接输出 repo-native artifacts 之前，允许存在一条 bootstrap import seam：

- 读取 typed export bundle
- 读取对象存储语义下的附件对象
- 重建 canonical raw/provider/source-truth

这条 seam 的 owner 固定为：

- `packages/ingestion-core`
- `apps/ingestion-worker`

它不应反向把外部 collector 的 SQLite / JSON schema 提升成 repo 级长期 contract。

同样固定补充：

- bootstrap import 可以调用 shared file asset loader，但不能把 worker 壳里的局部 parser / converter 反向提升成 source channel truth
- source-truth replay、attachment materialization 与 legacy Office normalization 必须继续复用 repo-owned shared contract，而不是在 collector/import seam 各自复制一套规则

## Runtime Connectivity Posture

这条 source channel 的长期 runtime 连接姿态固定为：

- 对象文件继续落在 `S3-compatible object storage`
- Postgres 只承载 registry、closeout/control-plane truth 与其他关系型 metadata
- repo-owned persistent runtime 默认按 `IPv4-only` 处理
- 当共享 Postgres 由 Supabase 承载时，`apps/ingestion-worker` 与后续 authenticated notice control-plane runtime 默认使用 `session pooler`
- 长驻 runtime 必须使用 application-side pooling；不把按操作建立数据库连接视为长期 accepted shape

因此这条 source channel 的前向扩展方向仍是：

`collector -> object storage + typed artifacts -> ingestion/control plane -> shared Postgres metadata truth`

而不是：

- 把对象迁入数据库或 Supabase Storage
- 在 runtime 内做 IPv6 探测后自动切 direct connection
- 把 transaction-mode pooler 当成长驻 worker 的主通道

## Restricted Rollout Posture

这条 source channel 的首个下游 collection 默认按 restricted institutional document rollout 处理。

推荐首个落点：

- `campus_notices/internal_notice`

默认姿态：

- `serving_stage=offline_preparation`
- 优先独立 restricted collection
- document / chunk projection 以 `visibility_* + entitlement_*` 为主

## Downstream Consumption Opening Posture

`campus_notices/internal_notice` 的 source-triage 与 restricted preparation 完成，不自动等于下游制度 collection 已可稳定消费。

长期固定规则：

- `internal_notice` 继续先承担 source-triage、provenance、wrapper notice 与 relation truth
- downstream consumption 只有在 source current scope、promotion boundary 与 target collection semantics 都稳定后才允许推进
- live portal scheduling 与 authenticated control-plane 不是 downstream consumption 的前置实现要求，但它们也不属于当前默认 rollout

对 `internal_notice -> regulations/*` 的后续 opening，至少需要同时满足：

- source-truth current scope 已稳定，不再处于大规模 owner recovery / relation recovery 波动期
- promotion boundary 已能稳定区分 `wrapper_notice_only`、`manual_review_required` 与可独立消费正文
- target collection 的 owner semantics、materialization contract 与 release posture 已冻结
- retrieval-prep 不会反向改写 source-triage truth，也不会把未稳定 source current scope 伪装成正式制度语义面

因此：

- downstream consumption 是后置的语义收口阶段，不是 source channel foundation 的默认延伸
- 在 source current scope 仍持续采集和修整时，正确姿态是继续保持 `offline_preparation` / promotion-prep，而不是抢先开放 query-serving

## Source-Triage Collection And Regulation Owner Boundary

对 authenticated notice source channel，`campus_notices/internal_notice` 的角色固定为：

- source-channel-first triage collection
- restricted replay / preparation / quality-evidence layer
- wrapper notice 与 attachment outcome truth 的持有层

它不是：

- formal regulation 的长期 semantic owner
- `regulations/*` 的替代品

因此固定规则为：

- wrapper notice、relation truth、`manual_review_required`、`reference_only` 等结果继续留在 `campus_notices/internal_notice`
- 如果 notice 正文或 attachment 正文已经具备独立制度消费语义，必须经过显式 promotion boundary 再进入独立 `regulations/*` collection
- 这条 promotion boundary 不改写 source-truth unit；原始 notice 仍继续作为 canonical upstream provenance 保留

当前 repo 级 target collection 命名固定为：

- `regulations/institutional_regulations`

## Restricted Document Center And Original Resource Boundary

对 authenticated notice / file release 这类登录态来源，repo 级长期形态允许再存在一层独立的 restricted product surface，用于承接：

- 原始附件对象
- `file_release` released originals
- 模板、表格、操作手册、FAQ、外部转发 PDF 等原件资源
- 这些原件的 metadata / provenance / download truth

这层推荐语义固定为：

- authenticated document center

它与 `regulations/*` 的边界固定如下：

- `regulations/*` 继续只承接 semantic-owner canonical text
- document center 承接 originals catalog / attachment library / released originals access
- `campus_notices/internal_notice` 继续持有 source-triage truth、wrapper notice 与 relation truth

因此：

- “对已认证用户有价值”不再自动等于“应进入 regulation collection”
- research notice / operational notice 中的大量附件，可以进入 document center 或后续 owner-specific collection，而不是污染 `regulations/institutional_regulations`
- regulation / retrieval 只能消费 document center 或 source-triage 层投影出来的 owner text 与 metadata，不能反向充当原始附件下载真相层

这层如果未来面向已认证用户开放，固定继续受：

- `app-api` canonical authz truth
- fail-close restricted rollout
- per-resource authorization projection

约束；不允许把“登录成功”偷换成“全部原件默认可见可下载”。

对应决策见：

- `docs/decisions/adr-0041-authenticated-document-center-and-regulation-layer-split.md`

对当前 internal notice 派生制度导入批次，固定补充规则为：

- `document_nature=institutional_regulation / annual_cycle_rule / time_bound_operational_rule` 都可以进入同一个 `regulations/institutional_regulations`
- `annual_cycle_rule` 与 `time_bound_operational_rule` 只作为 metadata 区分，不再因为时间范围或项目范围而被分流到另一条主导入 collection
- 真正继续留在 `campus_notices/internal_notice` 的，仍然是 `wrapper_notice_only`、draft/consultation、明确非制度 owner 的 source-triage 结果

这条 promotion boundary 不要求把当前批次再拆成多个 regulation collection；原始 notice 继续作为 canonical upstream provenance 保留。

对 regulation document 的标题与版本语义，已批准的下一步 contract 另见：

- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`

固定解释：

- 这是 approved migration target，不是当前 materialization code 已经生效的 execution truth
- 当前 execution 已使用 `regulation_work_title` 作为 target identity 输入
- 当前 execution 已使用 `regulation_display_title` 作为 projected/materialized title
- `regulation_title_normalized` 与 `source_title_literal` 继续作为 source-facing title metadata 保留
- 长期正确语义应收口到 `work title + edition label + display title`

对应决策见：

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`

## Semantic Owner Resolution

对当前 `internal_notice -> regulations/institutional_regulations` 导入批次，固定再补一层 `semantic owner` 解析。

这层回答的不是：

- 这条 notice 现在值不值得优先处理
- 这份附件应该走哪条 extraction lane

它只回答：

- 当前可独立消费的制度正文，究竟来自哪一层对象

第一版固定 owner 类型：

- `notice_body`
  - parent notice 正文自身已经是完整制度正文
- `attachment_document`
  - 制度正文在 notice 附件 child document 中
- `file_release_document`
  - notice 只是发布/实施说明，真实正文在门户文件发布页或等价外部 owner

固定规则：

- `notice family` 只控制处理优先级，不决定 semantic owner
- `attachment typed routing` 只控制提取路径，不决定 semantic owner
- 只有 owner 已恢复出的 canonical 正文，才允许进入 `regulations/institutional_regulations`
- wrapper notice 永远继续保留在 `campus_notices/internal_notice`

当前批次固定采用 fail-close：

- 如果 parent notice 正文明确出现 `附件：`、`参见《…》附件`、`信息门户-文件发布`、`自行下载参照执行` 一类 owner 指向信号
- 但 source-truth / child document 还没有恢复出对应 attachment owner 或 file-release owner
- 则结果必须是 `manual_review_required`
- 不得把这类 parent notice body 直接 promote 成 regulation 正文

这层解析结果必须作为显式 metadata 落盘，而不是在后置阶段重新猜测。当前第一版固定字段为：

- `semantic_owner_kind`
- `owner_source_missing_reason`

如果 source-truth import 当下还没有恢复出真实 `attachment_ref` / `file_release` relation，但正文已经明确给出 `附件：...`、`见信息门户-文件发布` 一类 owner 指向信号，则必须先把这类信号保留为 source-level `owner_expectations` extension fields，再由 promotion boundary fail-close。它们不是 attachment truth，也不能替代 child document；它们只是 upstream owner recovery contract，避免 source-truth 在 relation 缺失时把“应当存在的制度 owner”完全丢掉。

## Offline Attachment Consumption

`campus_notices/internal_notice` 的离线消费形态固定为“两层 projection”：

- 父 notice document 只承载 notice 正文与正文结构单元
- `attachment-refs.jsonl` 只作为 source-truth relation truth，不继续并入父 notice 的 chunk input
- 已下载附件必须 materialize 成 repo-owned derived child documents，再进入后续 split / cleanup / chunk pipeline

child attachment document 的长期约束：

- derived-from 固定为 authenticated notice source-truth，而不是 bootstrap bundle 或 collector 文件系统
- child document 必须显式携带 `projection_name`、`derived_from`、`derived_from_document_id`、`derived_from_raw_asset_id`、`derived_from_raw_version_id`、`parent_document_id`、`attachment_ref_id`、`attachment_kind`、`attachment_role`
- child document 继承父 notice 的 `visibility_*`、`entitlement_groups` 与 `policy_projection_version`
- child document 的 identity 表达“notice 内的稳定附件关系”，version 表达“附件内容 hash + extraction policy version”

attachment extraction lane 固定按类型分流，不做多套 fallback：

- `reference_only`：只保留 source-truth relation，不生成 child document
- `text_extractable`：走确定性的 native text extraction；当前 `internal_notice` 默认把 `docx`、`xls`、`xlsx` 这类可稳定原生解析的 Office 文本附件放进这条 lane
- `manual_review_required`：空间导览图、位置图和其他不以线性文本为主的 visual asset 不进入当前正文 OCR 主链路；只保留 relation truth，并显式记录 `review_reason`
- `ocr_required`：走 PaddleOCR-VL provider 路径；当前 authenticated notice historical replay 的 canonical runtime shape 仍是 cloud async jobs。对 `internal_notice`，规章制度 / 手册类 `pdf` 默认也进入这条 lane；native PDF extraction 最多只作为 diagnostics / probe，不是 canonical 主链路。对 `state=done` 但 `resultUrl.jsonUrl` 持续不可读的情况，只有在 attachment 已经确认属于有效 OCR candidate，且已结合 notice 正文上下文排除错误分流后，才视为 provider contract breach
- `unsupported_binary`：直接 fast-fail，不静默降级为可检索文档；当前 `.doc` 继续属于这条 lane，后续如果补齐，也只能通过 worker-owned normalization lane 回到现有 `text_extractable` 路径，而不是在 `ingestion-core` 内手写 legacy Word binary parser

`reference_only` 的固定补充：

- source-truth relation 可以保留平台编辑器或门户 chrome 观测到的静态资源，但这些 decorative asset 不进入 child document materialization
- 当前 internal notice projection 规则必须显式排除 editor static assets，例如 UEditor 默认主题下的 `spacer.gif` 之类占位图；它们属于 relation truth，不属于 OCR candidate
- 当前 authenticated notice 还必须显式排除“正文已经给出 canonical 文本说明”的辅助图片，例如二维码、示例证书、宣传海报、冗余的小程序/移动端操作截图；它们属于 relation truth，不属于 child document truth

当前 historical attachment corpus 中，image OCR 仍是 first-class lane，不是补丁路径；同时 policy / handbook 类 `pdf` 也默认走 cloud OCR。
但这个结论不覆盖空间关系主导视觉资产。像校园导览图、位置图、楼宇分布图这类内容，不属于当前 `ocr_required` lane 的 canonical 输入。

`ocr_required` 的固定语义补充：

- OCR 返回非空标准化文本时，必须 materialize child document
- OCR 返回空文本时，不得伪造空 child document，也不得把整条 notice replay 视为 source-truth 损坏
- 这类 attachment 继续保留 source-truth relation truth，但 closeout / replay 必须显式记录 `no_extractable_text` outcome，供 verifier 与 operator 审计
- 这不是 fallback；它是 `ocr_required` lane 的一等结果形态，典型样本包括二维码、纯图标、无正文的内联图片
- 对 `pdf` 来说，云端 OCR 结果是 canonical extraction truth；即使 PDF 自带 text layer，也不把 native extraction 结果视为默认通过依据
- materialized OCR child document 必须把 provider payload、`layout-elements.jsonl`、canonical markdown 与 `document-units.jsonl` 一并落成 repo-owned artifacts；`layout-elements.jsonl` 是 lane-local structure truth，不是临时调试副产物
- OCR provider 返回的 raw html table / markup 可以保留在 `layout-elements.jsonl` 供 lane 内结构修复使用，但不得直接泄漏进 canonical markdown 或最终 document units

`manual_review_required` 的固定语义补充：

- 这类 attachment 不是 `reference_only decorative asset`；它们仍然是 notice 的信息组成部分
- 当前 repo 只承认“保留 relation truth + 显式 manual outcome”这一条 canonical 形态，不把它们伪装成 OCR candidate
- `manual_review_required` 的典型样本包括校园导览总图、位置示意图、楼宇分区图等空间关系主导的内联图片
- frozen inventory / staged truth 必须保留 `classification=manual_review_required`、`materialization_policy=manual_review` 与 `review_reason`
- 这条 lane 当前不生成 child document，也不进入 chunk preparation；如果后续需要空间问答或地图理解，应另开 spatial/manual lane，而不是回退到 generic OCR

## Scope Materialization Rule

authenticated notice 的 attachment projection 以 source-truth replay 方式重建 canonical scope。

固定规则：

- projection runner 读取已落盘的 `notice-manifest.json`、`content-blocks.jsonl`、`attachment-refs.jsonl` 与附件对象
- projection runner 生成“clean parent notice docs + derived attachment child docs”的完整 scope snapshot
- final registry mutation 继续使用单次 `replace_scope(corpus, collection, records)` 收口
- scope refresh 不允许只写 child rows；任何 replay 都必须把父 notice rows 与 child attachment rows一并提交

这条规则服务于当前 `offline_preparation` collection，不表示 `internal_notice` 已开放 query-serving。

对 `internal_notice` 来说，具体的 split / cleanup / chunk lane design 不在本文内展开，固定由 `docs/reference/internal-notice-offline-preparation-strategy.md` 承担。本文只冻结 parent / child 分层与 attachment lane 的 repo-level 边界，不负责决定某个 lane 的具体 chunk budget。

## Future Control Plane

如果后续需要 run admission、heartbeat、operator read model 与 ingestion handoff，长期规则固定为：

- 必须新增 dedicated authenticated notice control-plane domain
- 不复用现有 `official_web` command/query surfaces
- 不把 collector control plane 混回 `apps/ingestion-worker`

这是一条前向约束，不表示当前 merged truth 已经实现该 control plane。

## Async Staged Closeout

Phase 12.2 已把 authenticated notice historical closeout 重构为 async staged pipeline，后续吞吐升级为 planning/worker split + batch-leased executor，详见：

- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`

固定规则：

- 每次 run 的 operations truth 落在 `campus_notices/operations/authenticated-notice-closeout/{run_id}/`
- run lifecycle 固定为 `planning -> planned -> running -> verifying -> verified -> promoting -> done|failed`
- planner 负责派生 repo-owned projection-only inventory（`ingestion_projection`），这个 inventory 既落在 `operations/.../ingestion_projection.json`，也写入 `ingestion_projection` 表，用来驱动 planner、verifier、promoter 对已冻结 scope 的 metadata view
- planner 冻结的是 attachment projection plan，而不是假设所有候选 attachment 都最终 materialize 为 child document；对于 attachment frozen truth 至少要区分 `required_document`、`conditional_on_extracted_text` 与 `manual_review`
- source-truth replay repair 必须只消费 run-owned frozen inventory 与 frozen source-truth objects，但允许用当前 projection rules 重新计算 `attachment_projection_plans`；不得回退到 live registry rescan，也不得盲目沿用已知错误的旧 plan classification
- planner 处基于 `ingestion_projection` 派生 shard/batch plan，并在 `ingestion_closeout.closeout_runs` / `closeout_batches` / `closeout_workers` 中依次写入 `planning_started`、`inventory_loaded`、`batches_frozen`、`planned` 这几个 milestone，后续 `show` / `watch` 只读这些聚合字段
- shard 负责 planning / aggregation；真正的执行单元是 leased batch
- worker / batch 可以并发写 source-truth objects 与 staged document objects，写入时必须直接采用 `ingestion_projection` 中的 typed stage columns（`projection_name`、`attachment_kind`、`extraction_lane`、`derived_from*`、`visibility_*`、`entitlement_*`、`policy_projection_version`）确保 downstream schema 固定
- worker 在处理 `ocr_required` attachment 时，除了 staged document rows，还必须把 attachment-level replay outcome 落进 staged notice truth；verifier 要求每个 OCR candidate 都有确定 outcome，而不是只靠 document rows 反推
- worker 只允许读取自己 claim 到的 batch input，不得重新 eager prepare 整份 bundle；批次完成后一次性在同一事务提交所有 `closeout_notice_stage`/`closeout_raw_asset_stage`/`closeout_document_stage` rows 以及 `closeout_batches`/`closeout_shards`/`closeout_workers` 聚合状态，避免 per-notice upsert 热路径写放大
- staging state 固定落在 `ingestion_closeout.closeout_*` 表，其中 batch / worker truth 由 `closeout_batches` / `closeout_workers` 持有
- promotion progress truth 由 `closeout_promotions` / `closeout_promotion_batches` 持有，`show` / `watch` 只能读这些聚合字段，不能靠 promotion stdout 或扫描 staged document rows
- batch notice/raw/document rows 与 run/shard/batch/worker 聚合状态必须在同一事务内提交
- shard 不得直接写 canonical `campus_notices/documents/internal_notice`
- 所有 batch 完成后，只允许一个 finalizer 把 run 切到 `verifying` 并执行 metadata-driven verification；验证器只读取 frozen projections / batch inputs 与 staged metadata（`sha256`/`content_length`/`raw_version_id`）再比对 object `HEAD`，不再回到 source-truth raw objects
- promotion 只允许单个 promoter 复制 staged document artifacts、构造 final registry rows、执行 `replace_scope`；promoter 在复制 raw assets 及 staged metadata 时直接参考 `ingestion_projection` / `closeout_raw_asset_stage` 的 scoped rows 以 bulk upsert 方式维护 `raw_asset_registry` / `raw_asset_versions`，无须做 full-scope scan
- promoter 内部允许并发 object-store native copy，但 single-writer scope mutation 语义不变；promotion copy 必须按 repo-owned batch truth 可恢复地推进，而不是依赖单个长时黑盒进程
- operator status / progress 读取 operations prefix 与 staging tables，而不是通过 rerun checkpoint 获取；`show` / `watch` 必须只读聚合 progress truth，不扫描全量 staged rows

## Current Status

当前文档冻结的是前向 accepted direction。

它不表示：

- `authenticated_notice_portal` 已经进入当前 merged truth
- 当前 repo 已经存在对应 collector app、collection config 或 operator surface

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 为准。

## Forbidden Shapes

- 不把登录态内部通知伪装成 `official_web`
- 不把 collector 的 SQLite 当成 repo 级 canonical truth
- 不把 `local_path` 提升成对象存储真相
- 不直接把 export JSON 当 query-serving collection
- 不让 collector 直接写 document registry、chunk 或 index
- 不让 restricted rollout 依赖 prompt-only 软约束
- 不把 wrapper notice 或 source-channel triage rows 直接写进 `regulations/*`
- 不把“正文提到附件/文件发布，但 owner source 缺失”的 notice body 误当成 regulation canonical text

## 相关稳定文档

- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `docs/plans/restricted-document-rollout-and-verification.md`
  - deferred rollout follow-up；当前执行真相以 `.planning/PROJECT.md` / `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md` 为准

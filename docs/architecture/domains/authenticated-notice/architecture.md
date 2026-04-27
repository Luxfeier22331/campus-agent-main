---
doc_type: architecture
status: active
created: 2026-04-03
updated: 2026-04-27
---
# Authenticated Notice Source Architecture

## 文档边界

本文冻结 `authenticated_notice_portal` source channel 的 repo-level supporting
architecture。

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

`external scheduler -> authenticated notice collector -> object storage + typed
bootstrap artifacts -> ingestion-worker -> document/chunk/index`

其中 `authenticated notice collector` 当前允许承接两条 authenticated portal surface：

- `notice`
  - `/comsys-portal-notice-web/*`
- `file_release`
  - `/comsys-prompt-portlet-web/*`

关键边界：

- collector 负责登录态复用、list/detail 抓取、正文/链接/附件增强、对象上传与 typed artifact 输出
- `apps/ingestion-worker` 负责 bootstrap import、source-truth
  重建、document/chunk/index 写入
- `packages/ingestion-core` 负责 source-truth contract、projection、registry 与
  release 语义
- 第一阶段不要求先落 `app-api` control plane

## Source Channel Rules

- `authenticated_notice_portal` 是一级 `source_channel`，不是 `official_web` 的特殊站点
- 这条 source channel 面向“登录态、机构内部通知”这类受限知识源
- downstream serving / retrieval 继续只消费 document / chunk / registry truth
- 当前 bootstrap seam 可以消费 typed export/import artifacts，但这些 artifacts 不是长期
  canonical truth

## Live Notice-Type Policy

- collector runtime 可以按执行安全性只启用 portal notice types 的一个子集
- 当前 repo-tracked live 默认 config 启用：
  - `5 / 办公通知`
  - `6 / 教学通知`
  - `8 / 科研通知`
  - `11 / 公示公告`
  - `32 / 学工通知`
  - `9980 / 学术信息`
  - `9982 / 常用下载`
- 当前 repo-tracked policy 还显式保留但默认禁用：
  - `10 / 就业信息`
  - `36 / 活动报道`
  - `9978 / 会议纪要`
  - `9979 / 民大要情`
- 这个 live config 只表达 bounded runtime policy，不表达 source-channel scope，也不表达
  notice-family truth
- 完整 portal taxonomy 与 live 样本事实用于冻结当前 source-channel scope；live config 的启用 /
  禁用状态不改写 source-truth 范围
- historical donor absorption 不得因为 live config 当前较窄，就反向改写 source-truth 范围

## Collector Run Admission

notice live run 必须先经过 collector-owned admission，再创建 portal API context：

- `incremental` / `backfill` run 必须至少有一个 enabled notice type
- `selected` run 必须显式给出 selected notice ids
- selected run 不扫描 notice-type list pages，只按 selected notice id / notice type 抓详情
- export manifest 必须记录 admitted collection mode、notice type ids、selected notice
  ids、expected page count、page budget 与 rejection reason shape

这个 admission report 是 live scheduler / operator 复核的 source-channel control truth。
它不代表 downstream consumption admission，也不打开 query-serving surface。

## Source Unit

这条 source channel 当前包含两个不同的 source surface：

- `notice`
- `file_release`

其中当前已经冻结 canonical source-truth contract 的 source unit 只有：

- `notice`

`file_release` 当前仍是 collector-owned typed export slice。它必须和 `notice`
分开采集、分开导出，不能把文件发布记录伪装成 notice，也不能把 notice 正文里“见信息门户-文件发布”的提示误当作 notice 自身正文。

同时，当前 repo 已接受一条 capture-only local PG ledger scope：

- `campus_notices/file_release_capture`

它只承接 `authenticated_notice_portal/file_release` 的 inventory / raw-asset truth，用于
owner-recovery readiness 与 operator 排障。

固定限制：

- 当前只 materialize 到本地 PG
- 只写 `ingestion_projection.authenticated_notice_file_release_inventory` 与同 scope
  的 raw-asset registry rows
- 不生成 `document_registry_records`
- 不进入 chunk / index / release
- 不把这条 scope 提升成 canonical `notice` source-truth 或 query-serving surface

当前这条 local PG ledger 已完成一次性 closeout materialization；repo 不再把 `file_release` PG
补齐保留为独立持续需求。

当前 collector-owned export shape、bundle/manifest 字段，以及 `reference_only` /
`object_store_write` 的含义，固定记录在：

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
- `notice_browser_url` / `portal_print_url` 只作为可浏览详情入口 metadata；它们不替代
  `source_notice_link`、`campusnotice://...` fallback、raw asset id 或 document id

## Contract Split

- source-channel 运行边界：本文
- notice discover/get runtime
  seam：`docs/contracts/campus-notice-runtime-contract.md`
- source-truth
  schema：`docs/data/authenticated-notice-source-truth-schema.md`
- shared file asset
  loader：`docs/architecture/system/file-asset-loader-architecture.md`
- `file_release` collector-owned export
  contract：`docs/reference/authenticated-notice-file-release-export-contract.md`
- shared data-plane 不变量：`docs/architecture/system/data-plane-architecture.md`
- `internal_notice` collection-specific offline preparation
  strategy：`docs/reference/internal-notice-offline-preparation-strategy.md`
- restricted document center artifact
  contract：`docs/reference/restricted-document-center-artifact-contract.md`
- authenticated document center / regulation 分层决策：`docs/decisions/adr-0041-authe
  nticated-document-center-and-regulation-layer-split.md`
- restricted document authorization：
  `docs/architecture/system/identity-and-authorization-architecture.md`

## Internal Notice Consumption Semantics

`campus_notices/internal_notice` 的 source holding collection、consumption
projection、查询 read model 与 notice tool runtime 是四个不同语义：

- archive / document registry / object storage：保存 source notice、canonical
  markdown 与附件 truth
- `notice_consumption_projection`：保存离线分类、authority / completeness /
  answerability、target surface 与 consumption status
- notice read model：notice tool 查询使用的 PG 查询视图 / 索引，不重新分类、不拥有
  source truth
- notice query runtime：执行 `campus_notice_discover` / `campus_notice_get`，只读取
  projection/read-model 与 canonical body，不承担留档；当前 repo 仅落成 package-level
  backing query service，不等于打开 panel/chatbot serving

notice-family taxonomy review 是 source-channel/operator 侧的只读抽样工作：

- 它可以从 historical bundle 或 source-truth inventory 生成 stratified sample report
- `--audit-output-path` 可生成全量只读 taxonomy audit artifact，包含全部
  terminal default-family residual notices 与 deterministic clusters；该 artifact
  只用于 operator 审计，不是 selected admission manifest
- 它产出 reviewer 可复核的 `notice_family`、`suggested_consumption_route` 与
  `machine_processing_policy`
- taxonomy rule 变更必须可通过 repo-tracked deterministic JSONL gate 回放，至少
  校验 `notice_family`、`suggested_consumption_route` 与
  `machine_processing_policy`
- 当前 taxonomy 已把稳定制度正文（管理办法、实施细则、实施办法、规定、管理规范、
  实施意见、章程、规则、规程等）归入 `regulation_candidate`；制度学习、解读会、宣传材料、
  方案和报告不作为 regulation 正文消费
- 当前 taxonomy 已把教务生命周期、课程/考试运行、培养项目选拔、学生状态注册、学生项目/奖励选拔、
  交换/公派留学、财务缴费/补贴/报销、健康医疗/福利、表格模板、问卷反馈、IT 操作说明、图书馆资源/荐购等高价值通知归入
  `notice_level_query`；把设施、教室、自习室、交通/班车、IT 平台、图书馆开放/关闭等可用性/开放时间变化归入
  `service_status_candidate`；把内部行政、人事/员工内部事项、研究宣传征稿、党团治理生活、一般文化宣传和校园新闻归入
  `defer`，且默认跳过低价值视觉处理
- fallback `other` 在缺少动作、服务、宣传或高价值证据时直接关闭为
  `no_adoption`，默认 `machine_processing_policy=skip`；需要视觉/附件理解的
  高价值通知进入 `pending_multimodal_processing`，不形成延后人工处理状态
- 它不代表 consumer admission，不写 projection/read model，也不打开 query-serving

新写入的 consumption projection 不再使用 `notice_runtime` 同时表示 holding、
read-model 与 runtime execution。notice-level 查询候选使用
`target_surface=notice_level_query` 与
`consumption_status=retained_for_notice_query`；采购/招标通知使用
`target_surface=procurement_notice_history`；service status 相关通知只作为
`campus_services/service_status_candidate` 候选；特殊服务预约/领取通知使用
`campus_services/special_service_candidate` 候选；稳定部门联系方式变更使用
`campus_services/stable_contact_candidate` 候选；internal restricted no-adoption 使用
`target_surface=unsupported`。这些 campus-services 候选只表示下游 typed materialization
输入，不打开对应 runtime lookup，也不得让下游在 query time 回扫通知正文。

交通类 notice 可以同时产生两类 campus-services 候选：班次、停运、临时调整等运行事实进入
`campus_services/service_status_candidate` 并由 `transport_schedule_lookup` 消费；预约入口、
预约开放时间与使用约束进入
`campus_services/special_service_candidate`，并由
`campus_services/service_guide` 生成只读 `service_guide_lookup` 记录。后者不得生成预约、
提交或签到 transaction payload。

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
- 只读 visual reference audit；用于从真实 portal detail HTML 中找出 `<img>`、lazy image、
  `srcset`、`<source>` 与 inline style image refs 的 selected export smoke 候选
- production capture package entrypoint / Docker image；调度由外部 cron、systemd 或
  Kubernetes Job 承担，collector 本身不升级成 product/API scheduler

它不负责：

- document registry
- chunking / embedding / index release
- retrieval serving truth
- restricted authorization projection 解释
- product/API heartbeat、operator read model 或 ingestion handoff；如后续需要这些能力，必须新增
  dedicated authenticated notice control-plane domain，不能复用 `official_web` surfaces

## Attachment Handling Boundary

对 authenticated notice source channel，附件对象的长期 owner split 固定如下：

- collector / source-truth layer
  - 负责附件发现、对象上传、attachment refs 与 source-level relation truth
  - 附件发现范围包括 notice detail `notice_annext`、正文 HTML attachment anchors、
    `<img>` / lazy-image attributes、`srcset` / `<source>` responsive image refs
    与 inline `style=url(...)` image refs
- shared file asset loader
  - 负责 admitted file-like attachment 的 normalization / extraction / terminal
    outcome
- collection-specific downstream
  - 决定哪些 extracted attachment child document 继续进入 cleanup / chunk / promotion

固定规则：

- attachment relation truth 不因为 shared loader 接入而离开 `notice` source-truth
- notice-referenced external visual assets 可以进入默认 source collection surface，但必须受
  collector-owned allowlist 约束；当前 allowlist 只包含 `mmbiz.qpic.cn`
- allowlisted external visual capture 不得复用 portal API context，不携带校园认证态或
  portal cookie；bundle 仍必须保留 `origin_scope=external`，对象 key 也必须显式标识
  external visual origin
- visual reference audit 只产出候选报告，不下载、不上传、不写 source truth；live proof 必须继续通过
  selected export + import smoke 形成
- `doc/xls -> docx/xlsx` 的 conversion service、OOXML deterministic
  parse、PDF/image parsing lane 都不属于 collector 私有 contract
- 如果 attachment 最终只落到 `reference_only`、`multimodal_processing_required` 或
  `unsupported_binary`，collector 仍只持有 source relation truth，不伪造 child document

## Bootstrap Import Ownership

在 collector 正式迁入 monorepo 并直接输出 repo-native artifacts 之前，允许存在一条 bootstrap import
seam：

- 读取 typed export bundle
- 读取对象存储语义下的附件对象
- 重建 canonical raw/provider/source-truth

这条 seam 的 owner 固定为：

- `packages/ingestion-core`
- `apps/ingestion-worker`

它不应反向把外部 collector 的 SQLite / JSON schema 提升成 repo 级长期 contract。

同样固定补充：

- bootstrap import 可以调用 shared file asset loader，但不能把 worker 壳里的局部 parser /
  converter 反向提升成 source channel truth
- source-truth replay、attachment materialization 与 legacy Office normalization
  必须继续复用 repo-owned shared contract，而不是在 collector/import seam 各自复制一套规则
- bootstrap import 默认只能按 bundle 内 notice ids 做 upsert；`incremental`、
  notice-type bounded、`max_notices` bounded 或 selected export 都不得刷新整个
  source scope
- full-scope source-truth / document-registry refresh 必须由 import request 的
  explicit replace-scope admission 或 export manifest 的 explicit full-scope
  source-truth import declaration 打开；不能从 `backfill`、notice type 列表或
  bundle 大小推断

补充约束：

- `context.session.selected_notice_ref` 只属于 query-time runtime carrier，不改变
  source-truth owner
- `notice-agent` 的 structured-runtime observability summary 只回传 compact
  execution summary，不回传 raw source bundle 或 raw agent dump

## Runtime Connectivity Posture

这条 source channel 的长期 runtime 连接姿态固定为：

- 对象文件继续落在 `S3-compatible object storage`
- Postgres 只承载 registry、closeout/control-plane truth 与其他关系型 metadata
- repo-owned persistent runtime 默认按 `IPv4-only` 处理
- 当共享 Postgres 由 Supabase 承载时，`apps/ingestion-worker` 与后续 authenticated notice
  control-plane runtime 默认使用 `session pooler`
- 长驻 runtime 必须使用 application-side pooling；不把按操作建立数据库连接视为长期 accepted shape

因此这条 source channel 的前向扩展方向仍是：

`collector -> object storage + typed artifacts -> ingestion/control plane ->
shared Postgres metadata truth`

而不是：

- 把对象迁入数据库或 Supabase Storage
- 在 runtime 内做 IPv6 探测后自动切 direct connection
- 把 transaction-mode pooler 当成长驻 worker 的主通道

## Restricted Rollout Posture

这条 source channel 的首个下游 collection 默认按 restricted institutional document rollout
处理。

推荐首个落点：

- `campus_notices/internal_notice`

默认姿态：

- `serving_stage=offline_preparation`
- 优先独立 restricted collection
- document / chunk projection 以 `visibility_* + entitlement_*` 为主

## Downstream Consumption Opening Posture

`campus_notices/internal_notice` 的 source-triage 与 restricted preparation
完成，不自动等于下游制度 collection 已可稳定消费。

长期固定规则：

- `internal_notice` 继续先承担 source-triage、provenance、wrapper notice 与 relation
  truth
- downstream consumption 只有在 source current scope、promotion boundary 与 target
  collection semantics 都稳定后才允许推进
- live portal scheduling 与 authenticated control-plane 不是 downstream consumption
  的前置实现要求，但它们也不属于当前默认 rollout

对 `internal_notice -> regulations/*` 的后续 opening，至少需要同时满足：

- source-truth current scope 已稳定，不再处于大规模 owner recovery / relation recovery 波动期
- promotion boundary 已能稳定区分 `wrapper_notice_only`、
  `requires_multimodal_processing` 与可独立消费正文
- target collection 的 owner semantics、materialization contract 与 release posture
  已冻结
- retrieval-prep 不会反向改写 source-triage truth，也不会把未稳定 source current scope
  伪装成正式制度语义面

因此：

- downstream consumption 是后置的语义收口阶段，不是 source channel foundation 的默认延伸
- 在 source current scope 仍持续采集和修整时，正确姿态是继续保持 `offline_preparation` /
  promotion-prep，而不是抢先开放 query-serving

## Downstream Consumer Admission Target

authenticated notice 的下游 consumer admission 是 source-channel foundation 之后、任何
projection/read-model/materializer 写入之前的独立闸门。它不是 collector run admission，也不是
taxonomy review：

- collector run admission 只决定是否允许抓取 portal surface
- bootstrap import admission 只决定是否允许把 export/source-truth 写入 repo-owned storage
  与 registry
- taxonomy review 只产出可复核的 family / route 建议
- downstream consumer admission 才决定某条 notice 是否进入 consumption
  projection、notice read model、campus-services typed candidate 或 no-adoption

目标态固定为 fail-close：

- `import_authenticated_notice_export` 默认只能产出 plan / dry-run report
- 任何 source-truth / registry / projection / read-model 写入，都必须显式选择写入 mode
- full-scope 或历史批量 materialization 还必须携带 repo-owned admission manifest；不能只靠
  `--mode admit-and-materialize` 打开全量写入
- admission manifest 之外的 notice ids 不允许被后续 projection rebuild、read-model
  rebuild、multimodal drain 或 typed materializer 通过重新扫描 source-truth inventory 扩张
- 缺少 projection store、read model store 或 typed candidate target store 时，对应阶段
  fail closed，不回退到临时内存 projection 或 raw/source-truth bundle scan

consumer admission manifest 的最小 contract：

- `schema_version`
- `admission_run_id`
- `source_channel`
- `corpus`
- `collection`
- `policy_version`
- `selection_source`
- `selection_path`
- `selection_sha256`
- `created_at`
- `scope_write_mode`
- `selected_notice_ids`
- `decision_counts`
- `decision_records`

每条 `decision_records` 至少包含：

- `notice_id`
- `source_notice_id` / `site_id`
- `raw_asset_id`
- `raw_version_id`
- `notice_family`
- `suggested_consumption_route`
- `target_surface`
- `consumption_status`
- `admission_decision`
- `admission_reason_codes`
- `body_quality`
- `attachment_ref_count`
- `reference_only_attachment_ref_count`
- `owner_expectation_count`
- `pending_multimodal_attachment_count`

目标 surface 的第一版允许集合固定为：

- `notice_level_query`
- `procurement_notice_history`
- `campus_services/service_status_candidate`
- `campus_services/special_service_candidate`
- `campus_services/stable_contact_candidate`
- `multimodal_processing_candidate`
- `unsupported`

固定决策语义：

- `notice_level_query` 只能进入 notice read model；它不等于 chatbot / panel 已开放 serving
- `campus_services/*_candidate` 只表示 typed materialization 输入；对应 service
  runtime 不得在 query time 回扫 notice body
- `multimodal_processing_candidate` 只允许从 projection 的 pending units 产生，不允许由 worker
  重新扫描 source-truth inventory 扩张候选集
- `unsupported` 必须携带 no-adoption reason，不能作为人工待办池无限保留
- owner/source relation 不完整、正文只指向附件或文件发布但 owner 未恢复、正文为空或只有标题的
  notice，默认不得进入 ready read model；只能进入 no-adoption、owner-recovery gap 或明确的
  pending multimodal lane

consumer admission release gate 必须在写入前生成可审计报告，至少校验：

- selected notice 数与 manifest 一致
- admission manifest 中的 notice ids 均可从 source-truth inventory 或当前 bundle plan 解析
- 空正文、reference-only attachment、owner expectation、unsupported binary、pending multimodal
  等计数没有超过本次 policy 阈值
- `replace_scope` / full-scope refresh 只能由 manifest 显式声明
- projection/read-model/campus-services materializer 只会消费 manifest admitted ids
- gate 输出同时包含 allow / block verdict 与阻断 reason codes

这条目标态的作用是把“历史通知源数据是否可信”和“哪些通知可以服务下游”分开。source-truth
可以作为受限 upstream 留档；query/read-model/campus-services 只能消费已 admission 的
projection truth。

## Source-Triage Collection And Regulation Owner Boundary

对 authenticated notice source channel，`campus_notices/internal_notice` 的角色固定为：

- source-channel-first triage collection
- restricted replay / preparation / quality-evidence layer
- wrapper notice 与 attachment outcome truth 的持有层

它不是：

- formal regulation 的长期 semantic owner
- `regulations/*` 的替代品

因此固定规则为：

- wrapper notice、relation truth、source-truth attachment
  `multimodal_processing_required`、`reference_only` 等结果继续留在
  `campus_notices/internal_notice`
- 如果 notice 正文或 attachment 正文已经具备独立制度消费语义，必须经过显式 promotion boundary 再进入独立
  `regulations/*` collection
- 这条 promotion boundary 不改写 source-truth unit；原始 notice 仍继续作为 canonical upstream
  provenance 保留

当前 repo 级 target collection 命名固定为：

- `regulations/institutional_rules`

## Restricted Document Center And Original Resource Boundary

对 authenticated notice / file release 这类登录态来源，repo 级长期形态允许再存在一层独立的 restricted
product surface，用于承接：

- 原始附件对象
- `file_release` released originals
- 模板、表格、操作手册、FAQ、外部转发 PDF 等原件资源
- 这些原件的 metadata / provenance / download truth

这层推荐语义固定为：

- authenticated document center

它与 `regulations/*` 的边界固定如下：

- `regulations/*` 继续只承接 semantic-owner canonical text
- document center 承接 originals catalog / attachment library / released originals
  access
- `campus_notices/internal_notice` 继续持有 source-triage truth、wrapper notice 与
  relation truth

因此：

- “对已认证用户有价值”不再自动等于“应进入 regulation collection”
- research notice / operational notice 中的大量附件，可以进入 document center 或后续
  owner-specific collection，而不是污染 `regulations/institutional_rules`
- `讲座预告 / 论坛 / 讲堂 / 读书会` 这类 `lecture_publicity` 内容不规划进入 document
  center；如用户需要，仍回官方门户查看
- `名单公示 / 成绩公示 / 结果公示 / 立项名单` 这类 `roster_publication` 内容不规划进入 document
  center；如用户需要，仍回官方门户查看
- regulation / retrieval 只能消费 document center 或 source-triage 层投影出来的 owner text
  与 metadata，不能反向充当原始附件下载真相层

这层如果未来面向已认证用户开放，固定继续受：

- `app-api` canonical authz truth
- fail-close restricted rollout
- per-resource authorization projection

约束；不允许把“登录成功”偷换成“全部原件默认可见可下载”。

对应决策见：

- `docs/decisions/adr-0041-authenticated-document-center-and-regulation-layer-sp
  lit.md`

对当前 internal notice 派生制度导入批次，固定补充规则为：

- `document_nature=institutional_regulation / annual_cycle_rule /
  time_bound_operational_rule` 都可以进入同一个 `regulations/institutional_rules`
- `annual_cycle_rule` 与 `time_bound_operational_rule` 只作为 metadata
  区分，不再因为时间范围或项目范围而被分流到另一条主导入 collection
- 真正继续留在 `campus_notices/internal_notice` 的，仍然是
  `wrapper_notice_only`、draft/consultation、明确非制度 owner 的 source-triage 结果

这条 promotion boundary 不要求把当前批次再拆成多个 regulation collection；原始 notice 继续作为
canonical upstream provenance 保留。

对 regulation document 的标题与版本语义，已批准的下一步 contract 另见：

- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`

固定解释：

- 这是 approved migration target，不是当前 materialization code 已经生效的 execution truth
- 当前 execution 已使用 `regulation_work_title` 作为 target identity 输入
- 当前 execution 已使用 `regulation_display_title` 作为 projected/materialized title
- `regulation_title_normalized` 与 `source_title_literal` 继续作为 source-facing
  title metadata 保留
- 长期正确语义应收口到 `work title + edition label + display title`

对应决策见：

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`

## Semantic Owner Resolution

对当前 `internal_notice -> regulations/institutional_rules` 导入批次，固定再补一层 `semantic
owner` 解析。

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
- 只有 owner 已恢复出的 canonical 正文，才允许进入 `regulations/institutional_rules`
- wrapper notice 永远继续保留在 `campus_notices/internal_notice`

当前批次固定采用 fail-close：

- 如果 parent notice 正文明确出现 `附件：`、`参见《…》附件`、`信息门户-文件发布`、`自行下载参照执行` 一类 owner 指向信号
- 但 source-truth / child document 还没有恢复出对应 attachment owner 或 file-release owner
- 则 source diagnostic 可以保留 `multimodal_processing_required` attachment classification；
  promotion action 不直接产出 attachment classification，而是使用
  `requires_multimodal_processing` 或 fail-closed no-adoption reason
- 不得把这类 parent notice body 直接 promote 成 regulation 正文

消费层固定不使用 `multimodal_processing_required` 作为 consumption status：

- source-truth attachment classification 的 `multimodal_processing_required` 只说明
  “采集层发现了非线性视觉素材”，不等于 VLM action backlog；是否花 token
  处理由 consumption projection 决定
- projection metadata 必须显式记录 `source_multimodal_processing_required_count`、
  `pending_multimodal_attachment_count`、`multimodal_consumption_policy` 与
  `multimodal_action_required`
- 低价值、短生命周期的讲座 / 活动 / 宣讲 / 工作坊类 inline-image 海报使用
  `multimodal_consumption_policy=skip` 与
  `multimodal_skip_reason=low_value_ephemeral_event_poster`，保留
  `target_surface=notice_level_query` / `retained_for_notice_query`，不进入
  pending multimodal drain
- 采购、名单/公示、流程/手册/材料/表格、附件指向、二维码/扫码/报名方式等可能改变用户行动或恢复正文的视觉缺口继续使用
  `multimodal_consumption_policy=process`
- 可由机器继续处理的视觉/非线性内容写入
  `target_surface=multimodal_processing_candidate` 与
  `consumption_status=pending_multimodal_processing`
- selected multimodal worker 可通过 env chat endpoint 处理这类 unit；结果只能回写为
  notice-level query/read-model truth 或 `no_adoption`，不得把视觉模型摘要直接冒充
  `regulations/*` ready target
- 视觉模型结果写回 projection 前必须经过 deterministic guard：
  `retain_for_notice_query` 需要非空 summary / extracted text 且不能是 low
  confidence；带可消费 extracted text 的 `no_adoption` 不能直接关闭，必须继续保持
  pending multimodal 以避免丢失潜在正文
- selected consumption worker 必须记录 consumer admission batch lifecycle，并把
  `consumer_admission_batch_id` 写入 projection/readable gap provenance；多模态处理尝试必须持久化为
  attempt truth，不依赖 worker 进程内计数
- consumer admission record 必须保存 selection source、selection path、selection
  sha256 与 command args；projection rebuild、multimodal processing、read-model
  rebuild / repair 都必须进入 started / completed / failed lifecycle
- consumer admission current batch 之外必须保留 append-only event log，用来追踪
  started / completed / failed 历史，不只依赖 current-state upsert
- pending multimodal drain 只能扫描 consumption projection 的 pending units，可按
  selected notices / selection path 限定；不得回扫 source-truth inventory 来扩张处理范围
- consumption projection、read model、admission current/event 与 multimodal attempt
  stores 必须有 repo-owned schema artifact / operator runbook；routing taxonomy 与
  multimodal eval gate 必须有 repo-tracked fixed JSONL fixture；routing gate 校验
  family / route / machine-processing policy，multimodal 默认 gate 包括 action
  fixture 与 visual-understanding fixture，后者只使用 synthetic/desensitized
  fixture 输出做 required span / forbidden claim / confidence / reason-code 检查，
  不把 restricted notice 原图上传到 hosted eval 平台
- downstream `regulations/institutional_rules` 与 `regulations/scoped_rules`
  materializer 只读 configured projection truth；未配置 projection store 时 fail
  closed，不得回退到 source-truth inventory 或空内存 projection
- owner/source relation 不完整的条目写入 `semantic_owner=authority_pending`，由
  processing gap audit 暴露，不伪装成 ready target
- 不属于当前 admitted lane 的硬性 no-adoption reason 写入
  `target_surface=unsupported` 与 `consumption_status=no_adoption`
- `multimodal_processing_required` 只允许作为 source-truth attachment classification
  出现，不允许作为新生成的 consumption projection status 或 promotion action
- legacy manual-review consumption migration path 不存在；历史未消费
  projection data 不迁移、不补写

这层解析结果必须作为显式 metadata 落盘，而不是在后置阶段重新猜测。当前第一版固定字段为：

- `semantic_owner_kind`
- `owner_source_missing_reason`

如果 source-truth import 当下还没有恢复出真实 `attachment_ref` / `file_release`
relation，但正文已经明确给出 `附件：...`、`见信息门户-文件发布` 一类 owner 指向信号，则必须先把这类信号保留为 source-level
`owner_expectations` extension fields，再由 promotion boundary fail-close。它们不是
attachment truth，也不能替代 child document；它们只是 upstream owner recovery contract，避免
source-truth 在 relation 缺失时把“应当存在的制度 owner”完全丢掉。

## Offline Attachment Consumption

`campus_notices/internal_notice` 的离线消费形态固定为“两层 projection”：

- 父 notice document 只承载 notice 正文与正文结构单元
- `attachment-refs.jsonl` 只作为 source-truth relation truth，不继续并入父 notice 的 chunk
  input
- 已下载附件必须 materialize 成 repo-owned derived child documents，再进入后续 split / cleanup
  / chunk pipeline

child attachment document 的长期约束：

- derived-from 固定为 authenticated notice source-truth，而不是 bootstrap bundle 或
  collector 文件系统
- child document 必须显式携带 `projection_name`、`derived_from`、`derived_from_document_
  id`、`derived_from_raw_asset_id`、`derived_from_raw_version_id`、`parent_document
  _id`、`attachment_ref_id`、`attachment_kind`、`attachment_role`
- child document 继承父 notice 的 `visibility_*`、`entitlement_groups` 与
  `policy_projection_version`
- child document 的 identity 表达“notice 内的稳定附件关系”，version 表达“附件内容 hash +
  extraction policy version”

attachment extraction lane 固定按类型分流，不做多套 fallback：

- `reference_only`：只保留 source-truth relation，不生成 child document
- `text_extractable`：走确定性的 native text extraction；当前 `internal_notice` 默认把
  `docx`、`xls`、`xlsx` 这类可稳定原生解析的 Office 文本附件放进这条 lane
- `multimodal_processing_required`：空间导览图、位置图和其他不以线性文本为主的 visual asset 不进入当前正文 OCR
  主链路；只保留 relation truth，并显式记录 `review_reason`
- `ocr_required`：走 shared OCR lane，并始终先归一化成 repo-owned canonical provider
  payload；对 `internal_notice`，规章制度 / 手册类 `pdf` 默认也进入这条 lane。provider 选择以 shared
  file-asset routing 为准：文档型 `pdf` / complex document image 默认 `MinerU primary ->
  Paddle fallback`，generic image 保持 Paddle 优先。native PDF extraction 最多只作为
  diagnostics / probe，不是 canonical 主链路。对 `state=done` 但 provider result
  持续不可读的情况，只有在 attachment 已经确认属于有效 OCR candidate，且已结合 notice 正文上下文排除错误分流后，才视为
  provider contract breach
- `unsupported_binary`：作为显式 terminal source-truth outcome 记录，不生成 child
  document，不计入 `reference_only`，也不静默降级为可检索文档；如果后续补齐该格式，只能通过
  worker-owned extractor / normalization lane 回到既有 `text_extractable` 或 OCR 路径，而不是在
  `ingestion-core` 内手写一次性 parser。当前 `.doc` 已经通过 shared legacy Office
  normalization lane 进入 `text_extractable`，`zip` 等压缩包仍属于 `unsupported_binary`

`reference_only` 的固定补充：

- source-truth relation 可以保留平台编辑器或门户 chrome 观测到的静态资源，但这些 decorative asset 不进入
  child document materialization
- 当前 internal notice projection 规则必须显式排除 editor static assets，例如 UEditor 默认主题下的
  `spacer.gif` 之类占位图；它们属于 relation truth，不属于 OCR candidate
- 当前 authenticated notice 还必须显式排除“正文已经给出 canonical
  文本说明”的辅助图片，例如二维码、示例证书、宣传海报、冗余的小程序/移动端操作截图；它们属于 relation truth，不属于 child
  document truth

当前 historical attachment corpus 中，image OCR 仍是 first-class lane，不是补丁路径；同时 policy
/ handbook 类 `pdf` 也默认走 cloud OCR。 但这个结论不覆盖空间关系主导视觉资产。像校园导览图、位置图、楼宇分布图这类内容，不属于当前
`ocr_required` lane 的 canonical 输入。

`ocr_required` 的固定语义补充：

- OCR 返回非空标准化文本时，必须 materialize child document
- OCR 返回空文本时，不得伪造空 child document，也不得把整条 notice replay 视为 source-truth 损坏
- 这类 attachment 继续保留 source-truth relation truth，但 closeout / replay 必须显式记录
  `no_extractable_text` outcome，供 verifier 与 operator 审计
- 这不是 fallback；它是 `ocr_required` lane 的一等结果形态，典型样本包括二维码、纯图标、无正文的内联图片
- 对 `pdf` 来说，云端 OCR 结果是 canonical extraction truth；即使 PDF 自带 text layer，也不把
  native extraction 结果视为默认通过依据
- materialized OCR child document 必须把 provider
  payload、`layout-elements.jsonl`、canonical markdown 与 `document-units.jsonl`
  一并落成 repo-owned artifacts；`layout-elements.jsonl` 是 lane-local structure
  truth，不是临时调试副产物
- OCR provider 返回的 raw html table / markup 可以保留在 `layout-elements.jsonl` 供 lane
  内结构修复使用，但不得直接泄漏进 canonical markdown 或最终 document units

`multimodal_processing_required` 的固定语义补充：

- 这类 attachment 不是 `reference_only decorative asset`；它们仍然是 notice 的信息组成部分
- 当前 repo 只承认“保留 relation truth + 显式 source diagnostic”这一条 canonical
  source-truth 形态，不把它们伪装成 OCR candidate；进入 consumption
  projection 后，可机器处理的 gap 必须转为 `pending_multimodal_processing`
- `multimodal_processing_required` 的典型样本包括校园导览总图、位置示意图、楼宇分区图等空间关系主导的内联图片
- frozen inventory / staged truth 必须保留
  `classification=multimodal_processing_required`、`materialization_policy=multimodal_processing`
  与 `review_reason`
- 这条 source lane 当前不生成 child document，也不进入 chunk preparation；如果后续需要空间问答或地图理解，应接入
  multimodal processing lane，而不是回退到 generic OCR 或人工终态

## Scope Materialization Rule

authenticated notice 的 attachment projection 以 source-truth replay 方式重建
canonical scope。

固定规则：

- projection runner 读取已落盘的
  `notice-manifest.json`、`content-blocks.jsonl`、`attachment-refs.jsonl` 与附件对象
- projection runner 生成“clean parent notice docs + derived attachment child
  docs”的完整 scope snapshot
- final registry mutation 继续使用单次 `replace_scope(corpus, collection, records)` 收口
- scope refresh 不允许只写 child rows；任何 replay 都必须把父 notice rows 与 child attachment
  rows一并提交

这条规则服务于当前 `offline_preparation` collection，不表示 `internal_notice` 已开放
query-serving。

对 `internal_notice` 来说，具体的 split / cleanup / chunk lane design 不在本文内展开，固定由
`docs/reference/internal-notice-offline-preparation-strategy.md` 承担。本文只冻结 parent
/ child 分层与 attachment lane 的 repo-level 边界，不负责决定某个 lane 的具体 chunk budget。

## Bounded Source-Channel Control Plane

当前 repo-owned bounded control plane 只覆盖 authenticated source-channel 排障与复核：

- collector run ledger 保存 collection mode、selected notice ids、artifact refs、attachment
  outcome counts 与完整 export manifest
- attachment fetch-status coverage report 对齐 current source-truth inventory 与 fetch-status
  rows，显式暴露 missing refs 与 extra historical refs
- live-historical reconcile report 在 coverage 基础上额外暴露 body-declared
  attachment owner-expectation mismatch，避免把“正文写了附件但 payload 未返回附件实体/ref”
  静默写成“无附件”
- reference-only explanation report 区分 terminal portal misses、object-backed inline
  images 与真正 action-required gaps
- visual reference audit report 只用于发现真实 portal 样本中的图片引用形态，并为后续 selected export
  smoke 提供候选，不替代 collector bundle、manifest 或 import smoke summary
- bounded operator status 只聚合 source-truth inventory、fetch-status coverage、reference-only
  explanation、unsupported binary count、multimodal count 与 latest collector run ledger

这些 worker CLI 属于 source-channel operations truth，不是对象存储浏览器、审批系统或产品
panel。

如果后续需要 product/API scheduler、heartbeat、operator read model 与 ingestion handoff，长期规则固定为：

- 必须新增 dedicated authenticated notice control-plane domain
- 不复用现有 `official_web` command/query surfaces
- 不把产品级 collector control plane 混回 `apps/ingestion-worker`

这是一条前向约束；当前 repo-owned closeout 只落成 bounded worker CLI 与 manifest /
ledger truth。

## Async Staged Closeout

Phase 12.2 已把 authenticated notice historical closeout 重构为 async staged
pipeline，后续吞吐升级为 planning/worker split + batch-leased executor，详见：

- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput
  .md`

固定规则：

- 每次 run 的 operations truth 落在
  `campus_notices/operations/authenticated-notice-closeout/{run_id}/`
- run lifecycle 固定为 `planning -> planned -> running -> verifying -> verified ->
  promoting -> done|failed`
- planner 负责派生 repo-owned projection-only inventory（`ingestion_projection`），这个
  inventory 既落在 `operations/.../ingestion_projection.json`，也写入
  `ingestion_projection` 表，用来驱动 planner、verifier、promoter 对已冻结 scope 的 metadata
  view
- planner 冻结的是 attachment projection plan，而不是假设所有候选 attachment 都最终 materialize 为
  child document；对于 attachment frozen truth 至少要区分
  `required_document`、`conditional_on_extracted_text` 与 `multimodal_processing`
- source-truth replay repair 必须只消费 run-owned frozen inventory 与 frozen
  source-truth objects，但允许用当前 projection rules 重新计算
  `attachment_projection_plans`；不得回退到 live registry rescan，也不得盲目沿用已知错误的旧 plan
  classification
- planner 处基于 `ingestion_projection` 派生 shard/batch plan，并在
  `ingestion_closeout.closeout_runs` / `closeout_batches` / `closeout_workers`
  中依次写入 `planning_started`、`inventory_loaded`、`batches_frozen`、`planned` 这几个
  milestone，后续 `show` / `watch` 只读这些聚合字段
- shard 负责 planning / aggregation；真正的执行单元是 leased batch
- worker / batch 可以并发写 source-truth objects 与 staged document objects，写入时必须直接采用
  `ingestion_projection` 中的 typed stage columns（`projection_name`、`attachment_ki
  nd`、`extraction_lane`、`derived_from*`、`visibility_*`、`entitlement_*`、`policy_p
  rojection_version`）确保 downstream schema 固定
- worker 在处理 `ocr_required` attachment 时，除了 staged document rows，还必须把
  attachment-level replay outcome 落进 staged notice truth；verifier 要求每个 OCR
  candidate 都有确定 outcome，而不是只靠 document rows 反推
- worker 只允许读取自己 claim 到的 batch input，不得重新 eager prepare 整份
  bundle；批次完成后一次性在同一事务提交所有
  `closeout_notice_stage`/`closeout_raw_asset_stage`/`closeout_document_stage`
  rows 以及 `closeout_batches`/`closeout_shards`/`closeout_workers` 聚合状态，避免
  per-notice upsert 热路径写放大
- staging state 固定落在 `ingestion_closeout.closeout_*` 表，其中 batch / worker truth 由
  `closeout_batches` / `closeout_workers` 持有
- promotion progress truth 由 `closeout_promotions` /
  `closeout_promotion_batches` 持有，`show` / `watch` 只能读这些聚合字段，不能靠 promotion
  stdout 或扫描 staged document rows
- batch notice/raw/document rows 与 run/shard/batch/worker 聚合状态必须在同一事务内提交
- shard 不得直接写 canonical `campus_notices/documents/internal_notice`
- 所有 batch 完成后，只允许一个 finalizer 把 run 切到 `verifying` 并执行 metadata-driven
  verification；验证器只读取 frozen projections / batch inputs 与 staged
  metadata（`sha256`/`content_length`/`raw_version_id`）再比对 object `HEAD`，不再回到
  source-truth raw objects
- promotion 只允许单个 promoter 复制 staged document artifacts、构造 final registry
  rows、执行 `replace_scope`；promoter 在复制 raw assets 及 staged metadata 时直接参考
  `ingestion_projection` / `closeout_raw_asset_stage` 的 scoped rows 以 bulk
  upsert 方式维护 `raw_asset_registry` / `raw_asset_versions`，无须做 full-scope scan
- promoter 内部允许并发 object-store native copy，但 single-writer scope mutation
  语义不变；promotion copy 必须按 repo-owned batch truth 可恢复地推进，而不是依赖单个长时黑盒进程
- operator status / progress 读取 operations prefix 与 staging tables，而不是通过 rerun
  checkpoint 获取；`show` / `watch` 必须只读聚合 progress truth，不扫描全量 staged rows

## Current Status

当前文档冻结的是前向 accepted direction。

它不单独表示：

- 某个分支是否已经合入 `develop`
- `authenticated_notice_portal` 已经打开 query-serving
- bounded worker CLI 已经升级成 product/API control plane

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

- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization
  .md`
- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput
  .md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spa
  tial-review-boundary.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`
- `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `.planning/workstreams/restricted-document-rollout-verification/README.md`
  - deferred rollout follow-up；当前执行真相以 `.planning/PROJECT.md` /
    `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md` 为准

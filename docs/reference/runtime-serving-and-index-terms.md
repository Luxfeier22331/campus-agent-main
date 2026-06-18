---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-28
updated: 2026-06-12
---
# Runtime Serving And Index Terms

## 文档边界

这份文档只负责解释当前运行面里最容易被混用的 serving / indexing 术语。

- 不重复长期 package 边界：`docs/architecture/target-architecture.md`
- 不重复 capability routing / admission supporting
  truth：`docs/architecture/system/capability-routing-and-admission-architecture.md`
- 不重复数据平面全景：`docs/architecture/system/data-plane-architecture.md`
- 不重复对象存储 key 约束：`docs/decisions/adr-0002-local-minio-conventions.md`
- 不重复旧 physical collection retention 决策：`docs/decisions/adr-0019-qdrant-physical
  -collection-retention-and-expiration.md`
- 不重复 self-hosted Qdrant native backup 策略：
  `docs/decisions/adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`
- 不承担当前执行状态真相：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream
  `STATE.md`
- 早期 `phase-1` 文档只作为历史背景或约束来源，不再单独承担当前 phase truth

## 术语

### Reader Permalink / Fragment / Highlight Query

定义：

- `reader permalink`
  - 学生侧可直接打开的文档阅读稳定链接，例如
    `/docs/:corpus/:collection/:docSlug`
- `published reader permalink`
  - 面向公开静态文档的 reader permalink；由发布/构建流程从 reader projection
    materialize 到 Rspress/static output
- `admitted reader permalink`
  - 面向 restricted / gated 文档的 reader permalink；链接形态仍在 `/docs/*`，但正文读取必须先通过
    admission
- `fragment identifier`
  - URL 中 `#<anchor>` 部分，表示浏览器内的章节/段落导航位置
- `highlight query parameter`
  - URL 中 `?hl=<rootUnitId1>,<rootUnitId2>` 部分，表示一次性正文块高亮意图

说明：

- 旧文档中出现的 `canonical reader target` / `canonical reader URL`
  容易被误读成运行时必须请求 `app-api` 解析的目标；新文档默认改用
  `reader permalink`。
- `canonicalUrl` 作为既有 HTTP JSON 字段名可暂时保留，但其语义应理解为 reader
  permalink，不应理解为 SEO 语境里的 canonical URL，也不应要求公开文档站运行时依赖
  `app-api`。
- `fragment identifier` 是 URL 标准术语；`highlight query parameter` 是本项目自定义
  URL search parameter。
- `chunkId`、`sourceUnitKey`、object-storage key 不进入 reader permalink。

### Corpus / Collection Scope

定义：

- retrieval/runtime 侧被显式命名和发布的 `corpus/collection` 边界

真相源：

- `configs/ingestion/<corpus>/<collection>/runtime-profile.json`
- `configs/ingestion/<corpus>/<collection>/README.md`
- `.planning/PROJECT.md`

说明：

- `source channel` 不等于 `corpus/collection`
- `corpus/collection` 不是顶层产品意图分类；只有当请求已经进入 knowledge-family path 后，这个 scope
  才开始承担 serving/runtime 语义
- 同一个 source channel 可以 fan-out 到多个 `corpus/collection` scope
- `official_web` 作为 source channel，不表示它只能有一个 mixed collection
- `official_web/stable_reference` 当前已经拆成默认 query-enabled serving scope；
  `official_web/fresh_news`、`official_web/news_archive` 仍是 default-off 后续 scope
- 正式规章与正式培养方案若已有更强语义 owner，应继续进入与 `official_web` 并列的
  `regulations/*`、`curriculum/*`

### Source-Triage Collection / Semantic-Owner Collection

定义：

- `source-triage collection`
  - 主要承接某个 source channel 的 replay、wrapper document、attachment
    outcome、manual-review truth 与 provenance
- `semantic-owner collection`
  - 只承接某个知识域下可独立消费的 canonical 文档正文

说明：

- 这两个角色可以都存在于同一个 data plane，但它们不是同一层
- `campus_notices/internal_notice` 属于 source-triage collection
- `regulations/*`、`curriculum/*` 属于 semantic-owner collection
- `campus_services/contact_directory` 也是 semantic-owner collection；即使当前仍是
  `offline_preparation`，它的长期角色也不是 `official_web/stable_reference` 的别名
- `campus_services/service_catalog` 也是 semantic-owner collection；即使当前仍是
  `offline_preparation`，它的长期角色也不是
  `official_web/stable_reference`、`student_rules` 或 generic RAG 的别名
- 某条 notice 可以成为 semantic-owner collection 的 provenance，但 notice 包装文本本身不应因此自动成为
  regulation member

补充说明：

- 如果联系方式问题后续被 admission 为 `contact_directory_lookup` structured runtime tool，该
  tool 应读取 `campus_services/contact_directory` semantic-owner projection，而不是直接读取
  public-web stable-reference chunk 或 handbook 原始页段
- 如果服务流程问题后续被 admission 为 `service_process_lookup` structured runtime tool，该
  tool 应读取 `campus_services/service_catalog` semantic-owner projection，而不是直接读取
  public-web stable-reference chunk、handbook 原始页段或 generic RAG retrieval result

### Query-Enabled Scope

定义：

- 当前允许进入 query-serving 主链路的 `corpus/collection` 范围

真相源：

- `configs/ingestion/<corpus>/<collection>/runtime-profile.json`
- `.planning/PROJECT.md`
- `docs/architecture/current-architecture.md`

说明：

- 当前 query-enabled scope 是 `regulations/student_rules`、
  `regulations/institutional_rules`、`curriculum/curriculum_plan` 与
  `official_web/stable_reference`
- `regulations/scoped_rules` 当前仍不属于默认 query-enabled scope，也不得进入默认
  RAG release candidate；它可以作为 `gated_asset` 进入 document-site read-model /
  docs reader release，由 `app-api` 做 reader admission
- `campus_services/service_status`、`campus_services/service_guide`、
  `campus_services/contact_directory`、`campus_services/transport_schedule` 与
  `calendar/academic_calendar` 当前是 `structured_query_serving`：它们只允许通过
  admitted structured tools 消费 current projection/read model，不进入 generic
  retrieval 默认 query scope
- `campus_services/service_catalog` 当前仍是 `offline_preparation`；later-wave
  `service_process_lookup` 未开放前，它不承担 structured product serving
- 当前 `official_web/muc_public_pages` 也是 `offline_preparation` 的 mixed
  bridge，不应误读成长期最终 serving scope

### Retrieval Qrels Fixture

定义：

- `packages/evals/fixtures/registry.v1.json` 登记的 `rag.*.retrieval_qrels` deterministic
  retrieval truth denominator；物理文件位于 `packages/evals/fixtures/rag/<surface>/`

说明：

- qrels fixture 以 `case_id`、query、scope、expected / forbidden source refs、authz /
  version request overrides 表达 retrieval gate truth
- 当前默认 query-enabled scope 必须都有 qrels fixture：
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
  - `official_web/stable_reference`
- qrels fixture 不等于 source truth、registry truth 或 release manifest；它是 eval / release
  gate 的 denominator

### Retrieval Eval Manifest

定义：

- qrels validation 用来 anchor document id / title 的 lightweight manifest

说明：

- 对有静态 split truth 的 collection，默认使用
  `configs/ingestion/<corpus>/<collection>/split-manifest.v1.json`
- 对 projection-derived 且没有静态 split manifest 的 scope，可使用同目录
  `retrieval-eval-manifest.v1.json`
- `retrieval-eval-manifest.v1.json` 只服务 deterministic qrels validation；不替代 registry
  scope、current pointer、release manifest 或 object-store artifact truth

### Retrieval Tuning Report

定义：

- `campus_evals.retrieval_tuning` 生成的 per-collection deterministic tuning artifact

说明：

- 输入是 qrels fixture 与一个或多个 candidate run-results
- candidate profile 可覆盖 dense / sparse prefetch、RRF 参数与 no-hit threshold
- 输出包含 positive hit / recall / MRR、forbidden hit rate、no-hit success、version-locked
  recall 与 `recommended_profile_patch`
- 只有 candidate 通过 deterministic gate 时才允许产生 recommendation
- tuning report 不自动改写 `runtime-profile.json`，也不自动扩大 query-enabled scope

### Capability Family

定义：

- supervisor 在 agent-owned execution 之前识别的顶层能力类别

说明：

- capability family 用于 surface admission、routing、guardrails 与 routing
  clarification
- capability family 不等于 `corpus/collection`，也不要求与 `selected_capability` 1:1 同名
- 这里描述的是分类层，不在本文新增新的 capability 枚举命名

### Surface Capability Allowlist

定义：

- 某个 product surface 当前 admission 的 capability family 集合

说明：

- surface capability allowlist 先于 knowledge-family scope 生效
- `public-chat-web` 当前 knowledge-only 是 current surface posture，不是长期产品架构原则
- 某条 capability 暂未在某个 surface 开放，不等于该 capability 已从长期产品架构里删除

### Knowledge-Family-Specific Scope

定义：

- 仅在请求已经进入 knowledge-family path 后，用来约束 serving surface 的 scope hint 或 resolved
  scope

说明：

- 当前常见承载形态是 `requestedScope` / `requested_scope` 与 `resolvedScope`
- 它可以映射到 `corpus/collection`，但它不是顶层产品意图分类
- 非 knowledge path 不应为了兼容旧心智而伪造等价字段

### Routing Clarification

定义：

- supervisor 为了判定 admission、capability route 或 handoff path，在 agent-owned
  execution 之前发起的澄清

说明：

- routing clarification 解决的是“请求应该进入哪个 admitted path”
- 它不应退化成 collection picker；如果问题本质上仍是 capability family 未决，就不应直接要求用户选
  `corpus/collection`
- 某些 surface 当前可以选择 fail-close，而不是把 routing clarification 直接暴露给终端用户

### Agent Clarification

定义：

- 在 capability route 已确定后，由 agent 为本域缺失参数、歧义或约束信息发起的澄清

说明：

- agent clarification 属于 agent-owned execution，不属于顶层 routing gate
- knowledge-family agent 可以用它补全时间、院系、版本或制度对象等 domain-specific slots
- 不同 agent 的 clarification shape 可以不同，但都不应回退成顶层 capability routing 代理

### Retrieval Plan

定义：

- planner-first retrieval 中由 agent 生成的 typed retrieval execution plan

说明：

- `RetrievalPlan` 属于 target-state contract，不表示当前所有 query path 都已采用 planner-first
  execution
- plan 必须在 admitted scope、authz、version mode、freshness gate 之内生成
- 细节冻结见 `docs/contracts/knowledge-retrieval-plan-contract.md`

### Retrieval Step

定义：

- `RetrievalPlan` 中单个可执行的 retrieval unit

说明：

- step 至少携带 step type、target scope、query、filter、budget
- step outcome 属于 query activity / execution metadata truth
- 细节冻结见 `docs/contracts/knowledge-retrieval-plan-contract.md`

### Planner Budget

定义：

- planner / executor 在一次 request 内可消耗的 steps、latency、live branch 次数等预算

说明：

- budget 耗尽应 fail-close
- budget 不是 prompt-only 软约束，必须有 code-owned enforcement

### Query Activity

定义：

- 一次 retrieval execution 的 step-level trace summary

说明：

- query activity 记录计划过什么、执行了什么、每步结果如何
- query activity 不等于最终 supporting evidence
- 细节冻结见 `docs/data/retrieval-query-activity-model.md`

### Candidate Set

定义：

- planner / executor 在各 retrieval step 中得到的候选集合

说明：

- candidate set 属于 execution truth
- candidate set 不等于可进入最终回答的 supporting evidence
- 细节冻结见 `docs/data/retrieval-query-activity-model.md`

### Supporting Evidence

定义：

- 最终允许进入回答的 answer-bearing evidence 子集

说明：

- supporting evidence 必须来自 candidate set 的受控子集
- citation、grounding、answer shaping 都围绕 supporting evidence 而不是 raw candidate
  trace
- 细节冻结见 `docs/data/retrieval-query-activity-model.md`

### Freshness Gate

定义：

- 对“今天 / 最新 / 最近 / 刚刚”一类 query 先进行的 freshness admission gate

说明：

- local freshness 足够时可继续当前 retrieval
- local freshness 不足时，只能进入 admitted live branch 或 fail-close

### Live Evidence

定义：

- 来自 admitted live source channel 的实时或近实时 evidence

说明：

- live evidence 不是 general web fallback
- live evidence 是否能成为 answer-bearing evidence，受 source-trust 与 freshness policy
  约束
- live evidence 必须显式标注 `retrieval_mode=live_assisted`、`as_of` 与
  `canonical_index_truth=false`
- live evidence 不写入 canonical index；它只能作为当前 retrieval execution 的临时 evidence
  和 observation / eval candidate 输入

### Execution Metadata

定义：

- retrieval execution 中产生的 plan / step / merge / rerank / freshness 分支摘要

说明：

- execution metadata 用于 observability、audit 与 grading
- execution metadata 不应直接暴露 raw vendor payload
- runtime observation 默认包含 query mode、retrieval mode、scope、latency、
  failure kind 与 sanitized query hash；raw query text 只允许 operator debug 显式打开

### Retrieval Observation Sink

定义：

- retrieval execution 将 sanitized runtime observation 发出的注入式回调边界

说明：

- sink 是显式 runtime contract；配置 sink 后，sink 失败必须让 answer path fail closed
  并暴露稳定诊断原因
- JSONL sink 是 local/debug 通道
- durable event sink 使用 `retrieval.runtime_observation` 事件名，交给 runtime adapter 接入
  OTel-compatible logs/events 或 operator observation storage
- sink 不得反向修改 release manifest、runtime profile、canonical qrels、serving alias 或
  answer evidence

### OTel Bridge

定义：

- runtime adapter 将 `retrieval.runtime_observation` 转成 OpenTelemetry-compatible
  logs/events/metrics/traces 的集成层

说明：

- OTel bridge 属于 runtime shell / deployment integration，不属于 retrieval-core
- trace/span correlation 可用时应保留；不可用时至少保留 `request_id`
- metrics 应从 observation 派生，例如 latency histogram、fail-closed count、release drift
  count、reranker degraded count 与 live-assisted count
- Collector/exporter/backend 选择不得成为 contracts 或 retrieval-core 类型

### Serving Alias

定义：

- release-managed collection 在 Qdrant 中暴露的稳定 collection 别名

真相源：

- runtime profile 中的 `qdrant_alias_name`

说明：

- serving alias 是 runtime-facing 稳定句柄，不等于某次具体发布生成的 physical collection
- query-serving collection 必须通过 serving alias 暴露
- `offline_preparation` collection 只要已经纳入 release-managed lifecycle，也应提前通过
  serving alias 暴露，避免后续上线时再做一次 collection rename / alias 迁移
- retrieval 默认只读取 serving alias，不直接绑定某次离线发布生成的 physical collection 名称

### Collection Prefix

定义：

- 某个 `corpus/collection` 在离线索引发布时用于生成 physical collection 名称的稳定前缀

真相源：

- runtime profile 中的 `qdrant_collection_prefix`

### Physical Collection

定义：

- 某次具体 index release 在 Qdrant 中实际写入的版本化 collection

命名：

- `<collection_prefix>__<release_id>`

说明：

- physical collection 是离线发布产物，不是运行时稳定接口
- serving alias 可以在多个 physical collection 之间切换

### Physical Collection Retention Role

定义：

- physical collection 在过期/清理策略里的保护角色

当前角色：

- `current`
  - alias 当前指向的 physical collection
- `previous`
  - 最新一次已发布 release 的热回滚位
- `migration_baseline`
  - 在 schema/model/policy/retrieval shape 迁移时额外保留的迁移前基线
- `archive_candidate`
  - 已脱离上述保护角色、可进入清理评估的旧 physical collection

说明：

- retention 采用 role-based policy，而不是 time-only deletion
- 删除门禁以 ADR-0019 和 operator runbook 为准

### Chunk Preparation

定义：

- 某个 collection 在 document truth 之后、index release 之前执行的一次 `split -> cleanup ->
  chunk -> validation` 离线准备动作

说明：

- `chunk preparation` 不产生 embedding，不写 Qdrant，不发布 serving alias
- `chunk preparation` 产生的是 preparation truth，不是 release truth
- 某些 `offline_preparation` collection 可以把 verified chunk preparation 作为 release
  gate

### Chunk Preparation Manifest

定义：

- 一次 chunk preparation 的小型追溯产物

对象存储位置：

- `{corpus}/operations/registry-scope-chunk-preparation/{preparation_run_id}/{co
  llection}/chunk-preparation.json`
- `{corpus}/operations/registry-scope-chunk-preparation/{preparation_run_id}/{co
  llection}/validation-summary.json`
- `{corpus}/operations/registry-scope-chunk-preparation/{preparation_run_id}/{co
  llection}/document-reports.jsonl`

说明：

- manifest 用于把 preparation 结果和 current registry scope 对齐
- manifest 必须记录 document-units object key hash、document-units content hash、
  chunk profile hash 与 chunk fingerprint hash；release 只能在这些 truth 与当前
  registry/object-store/config/chunk 结果一致时继续
- manifest 是 release gate 的输入，不是最终在线索引的替代物

### Index Release

定义：

- 一次完整的 `embedding -> indexing -> alias publish` 发布动作；对 preparation-gated
  scope，它发生在 verified chunk preparation 之后

说明：

- 一个 index release 对应一个 `release_id`
- 一个 release 会生成新的 physical collection，并在校验通过后发布 serving alias
- `index release` 可以依赖既有 chunk truth，但不应隐式承担 collection-specific chunk
  preparation 的 operator 语义

### Release Manifest

定义：

- 一次 index release 的小型追溯产物

对象存储位置：

- `{corpus}/releases/{collection}/{release_id}/index-release.json`
- `{corpus}/releases/{collection}/{release_id}/validation-summary.json`

说明：

- release manifest 用于审计、回滚和追溯
- release manifest 记录实际 embedding provider/model/dimensions、document-units
  content hash 与 chunk fingerprint hash，供 retrieval runtime 与发布审计确认同源
- provider-response replay 不发布 serving alias；alias 发布只走 registry-scope release
  path
- release manifest 不保存 chunk dump

### Qdrant Native Snapshot Bundle

定义：

- self-hosted Qdrant 节点上保存的一组 collection snapshot 恢复材料

文件系统位置：

- `/srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/backup-manifest.json`
- `/srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/<physical_collection_name>.snapshot`
- `/srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/sha256.txt`
- `/srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/restore-command.txt`

说明：

- native snapshot bundle 至少包含 snapshot 文件、`backup-manifest.json` 与
  `sha256.txt`
- 因为 collection snapshot 不包含 aliases，`backup-manifest.json` 必须记录
  `alias_bindings`
- native snapshot bundle 是恢复材料，不是在线 chunk truth
- staging R2 / serving seed bucket 不保存 Qdrant `.snapshot`

### Historical Object-Store Snapshot Backup Bundle

定义：

- ADR-0020 时期在对象存储里保存的 Qdrant collection 备份材料

说明：

- `{corpus}/backups/{collection}/{release_id}/{backup_id}/...` 只保留为历史清理对象
- 旧 bundle 不能被当作当前 backup 主路径

### Source Truth

定义：

- provider 私有响应之后、document projection 之前的 canonical rebuild boundary

说明：

- source truth 是后续 document build、chunking 和 replay 的上游真相
- source truth 进入对象存储；chunk dump 不进入对象存储

## 当前约束

- runtime profile 声明 serving alias、collection prefix 和 vector binding
- surface capability allowlist 先于 knowledge-family scope 生效；`corpus/collection`
  不是顶层产品意图分类
- source channel、corpus、collection、serving surface 是不同层；命名相近不表示必须一一对应
- source-triage collection 与 semantic-owner collection 也是不同层；不得把 wrapper notice
  collection 冒充成 regulation corpus
- physical collection 由 index release 生成，不由 env 或手写固定 collection 名直接指定
- 已进入 release-managed lifecycle 的 collection 不论当前是 `query_serving` 还是
  `offline_preparation`，都应使用稳定 alias + versioned physical collection
- preparation-gated scope 必须先拿到 verified chunk preparation，再进入 index release
- 旧 physical collection 默认先进入 `current / previous / migration_baseline /
  archive_candidate` 角色判断，再决定是否删除；不允许仅按年龄直接删除
- 对象存储保留 source/document artifact、release manifest 与 operations evidence；当前
  Qdrant native snapshot 不进入 serving seed bucket
- chunk preparation artifacts 落在 operations prefix，不落在 release prefix
- Qdrant 承载 chunk 文本、向量与检索 payload

## 易错点

- 不要把 serving alias 和 physical collection 混为一谈
- 不要把 `corpus/collection` 或 `requestedScope` 误当成 capability routing 的代理字段
- 不要把 routing clarification 和 agent clarification 混为一谈
- 不要把 chunk preparation manifest 误读成 index release manifest
- 不要把“文档历史版本必须保留”误读成“所有历史 physical collection 必须永久留在 Qdrant”
- 不要把 release manifest 当成 chunk store
- 不要把 snapshot backup bundle 误读成新的在线 query store
- 不要把早期 phase 文档中的固定 collection 或 handbook-only 叙事继续当作当前 truth

---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-01
---
# Retrieval Serving Architecture

## 文档边界

本文冻结 retrieval / serving 的 supporting architecture。

它回答的是：

- 当前 serving surface 与 retrieval baseline 是什么
- retrieval pipeline 如何分层
- 当前版本 serving 与未来历史查询如何统一在一套模型下

补充约束：

- 当前 merged truth 的 query-enabled surface 以
  `docs/architecture/current-architecture.md` 为准
- 顶层 capability routing 与 surface capability policy 不在本文维护；统一看
  `docs/architecture/system/capability-routing-and-admission-architecture.md`
- 本文负责解释 retrieval / serving 模型、internal surface 类别与长期版本查询边界，不维护 phase 顺序或
  rollout closeout
- full agentic retrieval 的长期 target truth 另见
  `docs/architecture/system/agentic-retrieval-architecture.md`

## Knowledge-Family Position

本文只描述 capability routing 已进入 knowledge-family path 之后的 retrieval / serving
truth。

固定规则：

- 顶层产品入口不先判 retrieval `scope`
- 只有当 supervisor 已把请求路由到 knowledge-family path 后，`requested_scope`、version
  mode、retrieval planning 才开始成立
- `service_status_lookup`、`campus_notice_discover/get`、`place_lookup` 这类结构化
  capability 不应再被误读成 retrieval scope 的旁支

## Accepted Retrieval Model

当前 serving surface 由 runtime profile 显式控制。

当前默认公开 query-enabled surface 仍限于：

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

当前还存在若干 internal retrieval surface，但它们不因此自动成为默认公开 query-serving collection：

- `curriculum/course_facts` internal agent retrieval surface
- `curriculum/program_family_facts` internal agent retrieval surface
- `curriculum/program_semester_facts` internal agent retrieval surface
- `regulations/scoped_rules` notice-derived scoped-rule holding collection

当前 accepted retrieval baseline 是：

- planner-first admitted retrieval
- dense + sparse hybrid retrieval step
- registry-backed evidence
- multi-step execution / merge / dedupe
- evidence bundle 回链
- agent 可以在 `curriculum_plan` 选中 scope 下内部切到
  `course_facts`、`program_family_facts`、`program_semester_facts`；selected scope
  不因此漂移
- `app-api` knowledge request 现在已经显式开放 `current` / `historical` / `as_of` /
  `compare` 这四种 version query mode；`freshness_sensitive` 与 `live_assisted`
  仍未作为产品 route 默认开放

这里的 `agent` 默认指 knowledge-family agent，而不是顶层 capability router。

## Current Baseline Vs Target Agentic Retrieval

当前 merged truth 仍是：

- planner-first retrieval baseline
- typed retrieval plan + bounded replan execution
- query framing 后进入 admitted collection / version selection，再进入多步 retrieval
  execution
- retrieval trace 与 final supporting evidence 分层

长期 target truth 则是：

- explicit freshness / live branch

因此：

- 本文描述当前已经合入的 planner-first knowledge retrieval truth
- `docs/architecture/system/agentic-retrieval-architecture.md` 继续描述 forward target
  里尚未对产品 surface 打开的 freshness/live branch
- 不得把 `live_assisted` 等 deferred branch 冒充成当前默认 product opening

## Current Retrieval Pipeline

knowledge-family 内部的 retrieval path 固定拆成：

`query framing -> scope / version admission -> retrieval planning -> multi-step
execution -> rerank / merge / dedupe -> evidence shaping`

owner 分层固定为：

- agent：query framing、ambiguity handling、surface / entity / version planning
- retrieval-core：step execution、fusion、merge / dedupe、evidence shaping
- registry / serving profile：version / visibility / serving scope truth

## Target Relation To Agentic Retrieval

长期 target pipeline 固定升级为：

`query framing -> scope / version / freshness admission -> retrieval planning ->
multi-step execution -> rerank / merge / dedupe -> supporting evidence selection
-> grounding-aware synthesis`

补充约束：

- planner-first target 不改变 serving truth owner
- retrieval-core 仍不拥有产品级 capability admission
- live branch 只允许进入 admitted source channel

## Serving Policy

serving truth 不写死在 supervisor、API shell 或 env 默认值里。

它由以下信息共同决定：

- collection runtime profile
- serving alias / release manifest
- current query-enabled scope
- explicit authz projection

## Release Safety And Tuning

query-enabled collection 的 release / serving hardening 固定包含以下层次：

- alias publish 前的 deterministic retrieval acceptance gate
- alias publish 前的 chunk quality gate；缺 traceability metadata、超过当前
  collection/profile chunk token budget、出现不可直接 query-serving 的 attachment-ref chunk
  或 regulation heading-only chunk 时，query-serving publish fail closed
- alias publish 前的 qrels coverage gate；默认 query-enabled scope 必须有 declared scenario
  denominator，缺 fixture、缺 required class 或缺 required scenario 都 fail closed
- release manifest / point payload 中的 dense、sparse、hybrid、chunk、cleaning、
  query instruction provenance、profile identity hash，以及 quality gate / chunk
  quality / qrels coverage / release metadata consistency status
- runtime 查询 alias 前的 release drift guard；profile / release metadata 不一致或 sampled
  point payload 混入不同 release/profile metadata 时 fail closed；guard cache key 必须包含
  collection 与 profile identity，profile 变更不得复用旧 guard 结果
- `packages/evals` 持有的 per-collection qrels scenario denominator、retrieval tuning
  report 与 sanitized runtime observation backlog intake

固定规则：

- qrels / tuning runner 只生成 deterministic evidence 与 `recommended_profile_patch`
- tuning 不自动修改 `runtime-profile.json`
- tuning 不扩大 query-enabled scope
- supplemental judge / RAGAS 指标只能做诊断，不作为 alias publish 或 profile patch 的唯一通过依据
- runtime retrieval 可以把 request/step outcome 发给显式注入的 observation sink；observation
  只作为 eval/backlog intake，不反向改变 release manifest、runtime profile 或 serving alias
- projection-derived scope 如果没有静态 `split-manifest.v1.json`，可以使用同目录
  `retrieval-eval-manifest.v1.json` 作为 qrels anchoring manifest；它不替代 registry、
  release manifest 或 current pointer truth

## Filter Layers

当前与长期都保留以下过滤层：

- serving-surface filter
- version-selection filter
- authz / visibility filter
- collection / entity / family filter

`major`、`cohort`、`program`、recent goal 等 personalization signal 只允许影响
applicability / preference / clarification，不得静默改写 visibility truth。

长期 target 里，这些 filter 仍然必须：

- 在 planner 阶段决定是否允许生成某类 step
- 在 executor 阶段继续做 step-level enforcement

## Versioned Serving Model

长期查询模型固定拆成：

- `current`
- `historical`
- `as_of`
- `compare`
- `freshness_sensitive`
- `live_assisted`

长期硬约束：

- 版本选择发生在 retrieval 之前
- 普通 query-serving 默认只查当前有效版本
- 历史版本查询必须显式化
- 多来源等价内容归并为一个逻辑 document version

## Merged Truth Vs Target Boundary

当前已经具备：

- 默认只服务当前有效版本
- explicit `current` / `historical` / `as_of` / `compare` query mode
- 多来源等价内容归并
- planner-first agentic retrieval

当前尚未完成：

- explicit freshness-sensitive branch
- explicit live-assisted branch

这些属于目标架构的一部分，而不是当前默认 surface；当前 active/deferred execution 仍以
`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、对应 workstream `STATE.md` 与相关
plan 为准。

## Course Facts Internal Surface

`curriculum/course_facts` 的长期定位保持为：

- agent-internal retrieval surface
- 用于课程 / 课程族实体与 alias governance
- 不自动提升成默认公开 query-serving collection

## Program Family Facts Internal Surface

`curriculum/program_family_facts` 的长期定位保持为：

- agent-internal retrieval surface
- 用于培养方案家族 membership / alias resolution
- 不自动提升成默认公开 query-serving collection

## Program Semester Facts Internal Surface

`curriculum/program_semester_facts` 的长期定位保持为：

- agent-internal retrieval surface
- 用于 resolved single-program + single-semester 课程清单问句
- 上游 truth 来自 canonical `curriculum_plan document-units` 的派生物化，而不是 raw/source
  bucket replay
- 不自动提升成默认公开 query-serving collection

## Structured Runtime Internal Surfaces

部分 runtime capability 长期不走 generic retrieval surface，而走 projection-backed
structured query seam。

当前已冻结方向包括：

- campus services family
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - later-wave `contact_directory_lookup`
  - later-wave `service_process_lookup`
  - 这些 structured runtime seam 的领域边界、projection owner 与 fail-close 规则统一看
    `docs/architecture/domains/campus-services/architecture.md`
- notice family
  - `campus_notice_discover`
  - `campus_notice_get`
  - 继续区分 public `official_web` notice family 与 restricted `internal_notice`
    notice family

固定约束：

- 这些 internal query surfaces 可以是 runtime-admitted structured seam，但不因此自动成为默认公开
  query-enabled collection
- future internal query service 只读 projection / normalized truth，不读
  query-disabled retrieval alias
- structured runtime surface 与 `fresh_news` 一类 retrieval surface 可以并存，但不能互相冒充
- structured campus-services runtime 不回退成 `service_catalog` reopening、generic
  retrieval alias 或 raw source scan

## Forbidden Shapes

- 不把 serving surface 写死在 supervisor 或 entry shell
- 不让 retrieval backend 自行猜测用户是不是要查历史版本
- 不把历史版本先全量检索再由回答层事后丢弃
- 不把 alias / family resolution 静默下沉成 retrieval backend 的黑盒字符串替换
- 不把 recent/latest 一类问法继续压成普通 current retrieval
- 不把 general web fallback 混入 campus retrieval 主路径

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `docs/reference/runtime-serving-and-index-terms.md`

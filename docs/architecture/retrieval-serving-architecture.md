---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-21
---

# Retrieval Serving Architecture

## 文档边界

本文冻结 retrieval / serving 的 supporting architecture。

它回答的是：

- 当前 serving surface 与 retrieval baseline 是什么
- retrieval pipeline 如何分层
- 当前版本 serving 与未来历史查询如何统一在一套模型下

补充约束：

- 当前 merged truth 的 query-enabled surface 以 `docs/architecture/current-architecture.md` 为准
- 本文负责解释 retrieval / serving 模型、internal surface 类别与长期版本查询边界，不维护 phase 顺序或 rollout closeout
- full agentic retrieval 的长期 target truth 另见 `docs/architecture/agentic-retrieval-architecture.md`

## Accepted Retrieval Model

当前 serving surface 由 runtime profile 显式控制。

当前默认公开 query-enabled surface 仍限于：

- `regulations/student_rules`
- `curriculum/curriculum_plan`

当前还存在若干 internal retrieval surface，但它们不因此自动成为默认公开 query-serving collection：

- `curriculum/course_facts`
  internal agent retrieval surface
- `curriculum/program_family_facts`
  internal agent retrieval surface
- `curriculum/program_semester_facts`
  internal agent retrieval surface

当前 accepted retrieval baseline 是：

- dense + sparse hybrid
- registry-backed evidence
- metadata pre-filter
- evidence bundle 回链
- agent 可以在 `curriculum_plan` 选中 scope 下内部切到 `course_facts`、`program_family_facts`、`program_semester_facts`；selected scope 不因此漂移

## Current Baseline Vs Target Agentic Retrieval

当前 merged truth 仍是：

- single-shot hybrid retrieval baseline
- query framing 后进入单次 admitted collection retrieval
- retrieval trace 与 final supporting evidence 分层

长期 target truth 则是：

- planner-first agentic retrieval
- typed retrieval plan
- multi-step execution
- explicit rerank / merge / dedupe
- explicit freshness / live branch

因此：

- 本文描述当前 accepted baseline
- `docs/architecture/agentic-retrieval-architecture.md` 描述长期 target shape
- 不得把 target-state planner/executor 口径冒充成当前 merged truth

## Current Retrieval Pipeline

retrieval path 固定拆成：

`query framing -> version / surface selection -> metadata filter -> candidate retrieval -> fusion / ranking -> evidence shaping`

owner 分层固定为：

- agent：query framing、ambiguity handling、surface / entity planning
- retrieval-core：candidate retrieval、fusion、evidence shaping
- registry / serving profile：version / visibility / serving scope truth

## Target Relation To Agentic Retrieval

长期 target pipeline 固定升级为：

`query framing -> scope / version / freshness admission -> retrieval planning -> multi-step execution -> rerank / merge / dedupe -> supporting evidence selection -> grounding-aware synthesis`

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

## Filter Layers

当前与长期都保留以下过滤层：

- serving-surface filter
- current-version filter
- authz / visibility filter
- collection / entity / family filter

`major`、`cohort`、`program`、recent goal 等 personalization signal 只允许影响 applicability / preference / clarification，不得静默改写 visibility truth。

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
- current-version serving
- 多来源等价内容归并

当前尚未完成：

- explicit historical query
- as-of query
- compare query
- planner-first agentic retrieval
- explicit freshness-sensitive branch
- explicit live-assisted branch

这些属于目标架构的一部分，而不是当前默认 surface；当前 active/deferred execution 仍以 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、对应 workstream `STATE.md` 与相关 plan 为准。

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
- 上游 truth 来自 canonical `curriculum_plan document-units` 的派生物化，而不是 raw/source bucket replay
- 不自动提升成默认公开 query-serving collection

## Structured Runtime Internal Surfaces

部分 runtime capability 长期不走 generic retrieval surface，而走 projection-backed structured query seam。

当前已冻结方向包括：

- `service_status_lookup`
  - 消费 `campus_services` current-effective status projection
  - 不是 `service_catalog` query-serving reopening，也不是 generic retrieval alias
- `transport_schedule_lookup`
  - 消费 route / service window / stop ref projection
  - 与 `navigation-agent` 消费 point refs 分层
- `campus_notice_discover`
  - 消费 notice discovery projection
  - 继续区分 public `official_web` notice family 与 restricted `internal_notice` notice family
- `campus_notice_get`
  - 消费 canonical notice body projection
  - 不直接扫描 raw/source-truth bundle

later-wave 已冻结方向包括：

- `contact_directory_lookup`
  - 消费 `campus_services/contact_directory` 的 contact entity / entity-group projection
  - 不是 `official_web/stable_reference` 的 generic retrieval 命中，也不是 raw directory page 扫描
  - public contact pages / handbook 电话页可以继续作为 provenance 上游，但不替代 semantic-owner runtime truth
- `service_process_lookup`
  - 消费 `campus_services/service_catalog` 的 process-oriented projection
  - 不是 `official_web/stable_reference` 的 generic retrieval 命中，也不是 raw flow page / raw说明页扫描
  - public service-entry page、official-web 办事说明页与 handbook flow page 可以继续作为 provenance 上游，但不替代 semantic-owner runtime truth

固定约束：

- 这些 internal query surfaces 可以是 runtime-admitted structured seam，但不因此自动成为默认公开 query-enabled collection
- future internal query service 只读 projection / normalized truth，不读 query-disabled retrieval alias
- structured runtime surface 与 `fresh_news` 一类 retrieval surface 可以并存，但不能互相冒充

## Forbidden Shapes

- 不把 serving surface 写死在 supervisor 或 entry shell
- 不让 retrieval backend 自行猜测用户是不是要查历史版本
- 不把历史版本先全量检索再由回答层事后丢弃
- 不把 alias / family resolution 静默下沉成 retrieval backend 的黑盒字符串替换
- 不把 recent/latest 一类问法继续压成普通 current retrieval
- 不把 general web fallback 混入 campus retrieval 主路径

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/agentic-retrieval-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `docs/reference/runtime-serving-and-index-terms.md`

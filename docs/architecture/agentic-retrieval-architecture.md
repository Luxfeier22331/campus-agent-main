---
doc_type: architecture
status: active
created: 2026-04-20
updated: 2026-04-21
---

# Agentic Retrieval Architecture

## 文档边界

本文冻结 `campus-agent` 长期目标中的 agentic retrieval supporting architecture。

它回答的是：

- planner-first retrieval 在本仓库里长期应长成什么样
- `rag-agent`、`retrieval-core`、runtime truth 各自负责什么
- multi-step retrieval、freshness / live branch、query activity 应如何收口

它不负责：

- 当前 merged truth 是否已经完成这些能力
- 某一轮 workstream 的执行顺序
- 某个 provider / SDK / vendor API 的具体接法

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 与
`docs/architecture/retrieval-serving-architecture.md` 为准。本文描述的是长期
target architecture，不得把它误读成当前已开放产品 truth。

## Core Conclusion

`campus-agent` 的长期 retrieval 目标不是继续停留在 single-shot hybrid query，
而是演进为：

`bounded campus agentic retrieval`

它的长期固定形态是：

- planner-first
- typed retrieval plan
- multi-step execution
- explicit freshness / historical routing
- answer-bearing evidence 与 raw candidate trace 分层
- fail-close by default

它仍然不是：

- 开放域 general web fallback
- prompt 内隐式工具调用黑盒
- 让 retrieval backend 自行决定产品 scope 的自治代理
- 把 service status、transport schedule、canonical notice reading 这类结构化当前状态问题强行塞进 retrieval planner

## Why Agentic Retrieval Exists Here

长期引入 agentic retrieval 的原因固定为：

- 用户问题会跨条款、跨培养方案层级、跨说明页与近期信息
- `current / historical / as_of / compare / freshness-sensitive` 问题不适合继续压成一次检索
- campus assistant 需要更强的 query planning，但不能牺牲 authz、source-trust 与 fail-close

因此本仓库的 agentic retrieval 目标始终是：

- 在 institution-scoped campus assistant 内提升 retrieval planning 能力
- 不把产品边界扩写成开放域问答

同时固定保留一个并列结论：

- `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover/get` 这类结构化 runtime capability 不属于 agentic retrieval 本身
- 它们应通过 projection-backed internal query service + domain-agent tool adapter 提供，而不是伪装成 retrieval step

## Long-Term Execution Shape

长期主链路中的 retrieval 片段固定为：

`supervisor admission -> rag-agent scope resolution -> rag-agent retrieval planner -> typed retrieval plan -> retrieval-core executor -> query activity / step results -> supporting evidence selection -> rag-agent synthesis -> grounding validation -> supervisor finalization`

其中：

- supervisor 负责 capability / policy / top-level routing admission
- `rag-agent` 负责 plan 与 answer 语义
- `retrieval-core` 负责 retrieval execution，不拥有产品级 scope 决策

## Ownership Model

### `packages/rag-agent`

长期负责：

- resolved scope / query mode 解析
- retrieval plan 生成
- replan decision
- supporting evidence selection policy
- grounded answer synthesis

不负责：

- canonical authz truth
- runtime profile 的最终 owner 决策
- retrieval backend vendor freeze

### `packages/retrieval-core`

长期负责：

- retrieval step execution
- per-step metadata filter enforcement
- rerank / threshold / merge / dedupe
- query activity / execution metadata
- candidate set shaping

不负责：

- 隐式扩面到未开放 collection
- 在无 planner truth 时自猜历史语义、freshness 语义或产品 capability

### runtime truth owners

- `apps/app-api`
  - authz projection、identity projection、operator-facing read model
- runtime profile / registry / release truth
  - collection posture、visibility、serving alias、version mode
- `packages/supervisor-core`
  - policy / capability admission

## RetrievalPlan

长期 `RetrievalPlan` 固定是 typed contract，而不是 prompt 内部不可见的推理副作用。

它至少应显式表达：

- resolved capability
- resolved `corpus/collection` 或 admitted cross-scope branch
- query mode
  - `current`
  - `historical`
  - `as_of`
  - `compare`
  - `freshness_sensitive`
  - `live_assisted`
- ordered retrieval steps
- plan budget
- source-trust / freshness requirements
- fail-close condition

固定规则：

- plan 只能引用 admitted step types
- plan 不能扩大 query-enabled surface
- plan 不能绕过 authz / visibility filter

## RetrievalStep

长期每个 `RetrievalStep` 都必须是 typed、可追溯、可观测的执行单元。

每个 step 至少应表达：

- `step_id`
- `step_type`
- target scope
- normalized query
- metadata / authz / version filter
- freshness requirement
- expected output class
- step budget

## Allowed Step Types

长期 admitted step types 固定优先包括：

- `indexed_lookup`
  - 面向单一 admitted collection 的普通索引检索
- `entity_resolution`
  - 面向课程、方案家族、制度对象、地点等实体分辨
- `scope_follow_up`
  - 在已 admitted 的 capability 内切换到 internal retrieval surface
  - 只保留给 future explicit admission；首轮稳定 contract 可以先把它作为 reserved value，而不是
    初始 executor 必须支持的 execution value
- `historical_version_lookup`
  - 显式 historical / `as_of` 版本定位
- `compare_pair_lookup`
  - 为 compare 查询准备双侧 evidence
- `freshness_gate`
  - 判断近期/最新语义是否允许继续回答
- `live_source_lookup`
  - 只允许命中 repo admitted 的 live source channel

长期禁止新增：

- general web browse fallback
- 未经 repo 文档 admission 的 remote capability
- 以 provider 内置黑盒 web tool 替代 repo-owned source truth

## Plan Lifecycle

长期 plan lifecycle 固定为：

1. query framing
2. policy / scope / authz admission
3. query mode resolution
4. plan emission
5. step execution
6. optional bounded replan
7. candidate merge / rerank / threshold
8. supporting evidence selection
9. synthesis + grounding validation

## Budget Model

长期 planner / executor 必须显式拥有 budget truth。

至少包括：

- max step count
- retrieval latency budget
- planner reasoning budget
- live lookup budget
- compare / historical extra-step budget

预算耗尽时固定 fail-close，不得默默退化成：

- 无依据自由回答
- 未授权 live branch
- 隐式放宽 top-k 或 scope

## Surface, Authz, Freshness, Source-Trust Gates

agentic retrieval 不是对当前 gate 的替代，而是必须显式经过这些 gate：

- serving-surface gate
- authz / visibility gate
- version-mode gate
- freshness gate
- source-trust gate

固定规则：

- planner 不能把 `offline_preparation` surface 当作默认可答 surface
- freshness-sensitive query 在 local freshness 不足时，只能走 admitted live branch 或 fail-close
- 低信任 remote evidence 不能直接成为 answer-bearing evidence

## Candidate Set Vs Supporting Evidence

长期固定区分两层 truth：

- `candidate set`
  - planner / executor 在各 step 中看到的原始候选集合
- `supporting evidence`
  - 最终允许进入回答的 answer-bearing evidence

固定规则：

- supporting evidence 必须是 candidate set 的受控子集
- raw candidate trace 属于 execution / observability truth，不等于最终 answer truth
- 不能把“召回过”直接等同于“可支持回答”

## Rerank, Merge, And Dedupe

长期 `retrieval-core` 可以执行：

- rerank
- thresholding
- duplicate collapse
- cross-step merge
- title / entity / version-aware dedupe

但它不能：

- 改写产品 scope
- 静默抹平 historical / current 差异
- 把 archive/historical 结果偷塞回当前默认答案

## Historical, Compare, And Freshness-Sensitive Queries

长期 query mode 固定显式化：

- `current`
- `historical`
- `as_of`
- `compare`
- `freshness_sensitive`
- `live_assisted`

固定规则：

- query mode 在 retrieval 之前确定
- historical / compare 不是回答层事后解释
- recent / latest / today 一类问法不得在 freshness gate 缺失时继续假装可答

## Failure Semantics

长期 agentic retrieval 固定 fail-close 于以下分支：

- no admitted plan
- unauthorized target scope
- unsupported query mode
- insufficient freshness
- insufficient answer-bearing evidence
- planner / executor budget exhausted
- live branch unavailable

## Observability And Query Activity

长期至少保留以下 agentic retrieval execution truth：

- plan summary
- step count
- step latency
- step outcome
- replan count
- rerank summary
- merge / dedupe summary
- final supporting evidence summary
- freshness branch outcome
- live retrieval outcome

这些 execution-side truth 用于 operator observability、quality grading 与 release gate，
但不应直接暴露 raw snippets 或 vendor payload。

## Evaluation Model

长期 agentic retrieval eval 必须在 classic retrieval qrels 之外补齐：

- query decomposition correctness
- step-plan appropriateness
- compare answer evidence completeness
- freshness branch correctness
- live branch fail-close correctness
- supporting evidence selection correctness

## Forbidden Shapes

- 不把 retrieval plan 藏在 prompt 自由文本里而没有 typed artifact
- 不让 planner 静默打开未开放 collection
- 不让 executor 自主决定历史/当前/近期语义
- 不把 general web fallback 混入 campus retrieval 主路径
- 不把 raw candidate trace 直接当 supporting evidence

## 相关稳定文档

- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/rag-agent-retrieval-plan-contract.md`
- `docs/data/retrieval-query-activity-model.md`
- `docs/reference/runtime-serving-and-index-terms.md`

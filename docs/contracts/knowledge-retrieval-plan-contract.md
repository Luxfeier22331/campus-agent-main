---
doc_type: contract
status: active
created: 2026-04-21
updated: 2026-06-05
---
# Knowledge Retrieval Plan Contract

## 文档边界

本文冻结 `packages/knowledge-capability` 与 `packages/retrieval-core` 之间的
typed retrieval plan seam。

它回答的是：

- `RetrievalPlan / RetrievalStep / StepResult` 的最小稳定 shape 是什么，以及如何映射到
  durable `RunStep` / `StepResult`
- planner / executor 各自拥有什么语义 owner
- `version_query`、freshness、source-trust、budget 与 fail-close 如何进入 plan
- 哪些字段属于 internal retrieval seam，不能泄漏成 browser / supervisor-facing contract

它不负责：

- browser-facing HTTP schema
- supervisor -> capability handoff schema
- 当前 multi-step executor 的具体代码实现
- 通用工具平台或开放域 browse contract

补充约束：

- 这份 contract 记录的是稳定 runtime seam，不等于 `packages/contracts` 里的 shared package
  placement
- 当前 merged truth 仍以 `docs/architecture/current-architecture.md` 与
  `docs/architecture/system/retrieval-serving-architecture.md` 的 single-shot baseline
  为准； 本文冻结的是 target-state 进入实现前必须先明确的 seam truth

## Core Conclusion

`RetrievalPlan` 在本仓库里固定是 repo-owned typed artifact，并且必须能投影到 durable
step trajectory，而不是 prompt 内部不可见的自由文本状态。

固定结论：

- `knowledge` 负责生成 `RetrievalPlan`
- `retrieval-core` 负责执行 `RetrievalStep`
- `RetrievalRequest` 是 executor kernel input，不等于 `RetrievalStep`
- 每个 `RetrievalStep` 必须映射到 durable `RunStep`
- `StepResult` 固定拆成四层：
  - `grounding`
  - `references`
  - `activity`
  - `failure`
- budget、authz、version、freshness、source-trust 都必须在 plan / step seam 上显式表达或显式继承
- evidence verifier 的结果必须进入 step result；synthesis 不得补齐缺失 evidence

## Contract Placement

这组类型的首轮稳定 placement 固定为：

`knowledge planner -> retrieval plan contract -> retrieval-core executor`

固定规则：

- `packages/contracts` 当前不承载 `RetrievalPlan / RetrievalStep / StepResult`
- `apps/app-api`、`apps/execution-control`、`apps/supervisor-agent-worker` 与
  browser surface 不得依赖这组内部类型
- operator / browser 最终只应看到衍生后的 supporting evidence 或 operator-safe execution
  summary，而不是 raw plan / raw vendor payload
- run projection 可以保存 sanitized plan / step / result projection，用于 scheduler、
  eval、panel 与 badcase 回链

## RetrievalPlan

`RetrievalPlan` 的最小稳定字段组固定包括：

```text
RetrievalPlan
- plan_id: str
- run_id: str
- query_mode:
  - current
  - historical
  - as_of
  - compare
  - freshness_sensitive
  - live_assisted
- admitted_scopes[]:
  - corpus
  - collection
- version_query: existing typed version query | null
- source_trust_policy:
  - minimum_tier
  - allow_live_source_lookup
- budget:
  - max_steps
  - max_replans
  - max_live_lookups
- steps[]: RetrievalStep
- fail_close:
  - on_budget_exhausted
  - on_unresolved_freshness
  - on_empty_supporting_evidence
```

固定语义：

- `query_mode` 复用现有 `current / historical / as_of / compare /
  freshness_sensitive / live_assisted` vocabulary，不再另造第二套 mode 名称
- `admitted_scopes` 由 capability / serving-surface / authz gate 先决决定，planner 只能在
  这个闭集内排布 steps
- `version_query` 复用已冻结的 versioned-history truth；plan 不重写版本解析语义
- `source_trust_policy` 只表达 answer-bearing evidence 的最低可信门槛，不等于 remote tool
  router
- `budget.max_steps` 计入 replan 后插入的新增 steps；预算耗尽固定 fail-close
- `run_id` 是 run projection correlation，不由 retrieval-core 生成

## RetrievalStep

`RetrievalStep` 的最小稳定字段组固定包括：

```text
RetrievalStep
- step_id: str
- run_step_id: str
- step_type: closed vocabulary
- stage:
  - planning
  - tool
  - retrieval
  - rerank
  - selection
  - synthesis
  - grounding
- scope:
  - corpus
  - collection
- query_text: str
- depends_on_step_ids[]: str
- selector:
  - target_document_ids[]
  - target_version_ids[]
  - target_revision_track
  - preferred_document_ids[]
  - entity_keys[]
- budget:
  - top_k
  - timeout_ms | null
- expected_output:
  - candidate_set
  - entity_matches
  - freshness_decision
  - compare_inputs
  - live_candidates
  - coverage_verdict
  - supporting_evidence
```

固定语义：

- `selector` 只表达 planner 允许设置的 narrowing intent，不冒充 executor 的完整 request shape
- authz / visibility filter 不是 planner-owned field；executor 必须从 request context
  继续强制 enforcement
- step 可以比 plan 更窄，不能比 plan 更宽
- `depends_on_step_ids` 表达依赖顺序；executor 可以在不破坏依赖的前提下并行独立 steps
- `run_step_id` 必须指向 durable `runtime.agent_run_steps` 中的同一 typed execution unit

## Allowed Step Vocabulary

`step_type` 固定是 closed vocabulary。

当前 admitted execution values：

- `hybrid_search`
  - 单一 admitted collection 的索引检索
- `document_section_read`
  - 读取 canonical document section / root unit
- `parent_context_expand`
  - 在 admitted document 内做 parent / child context expansion
- `rerank`
  - 执行 admitted rerank profile
- `evidence_coverage_verify`
  - 验证 candidate / supporting evidence 是否覆盖 query 要求
- `supporting_evidence_select`
  - 选择 answer-bearing supporting evidence
- `entity_resolution`
  - 实体分辨、别名定位、canonical identity 收敛
- `historical_version_lookup`
  - historical / `as_of` 版本定位
- `compare_pair_lookup`
  - compare 问题的双侧 grounding 准备
- `freshness_gate`
  - 判断 local freshness 是否足以继续回答
- `live_source_lookup`
  - 只允许命中 repo-admitted live source channel

当前 reserved value：

- `scope_follow_up`
  - 只保留给“同一 admitted capability 内切换 internal retrieval surface”的显式扩展；
    未 admission 时 executor 必须拒绝它

固定排除：

- `service_status_lookup`
- `transport_schedule_lookup`
- `campus_notice_discover`
- internal selected notice resolve with `payload_kind=campus_notice_get`
- general web browse
- provider black-box web tool
- 未经 repo 文档 admission 的 remote capability

## Query Mode Vs Step Type

固定规则：

- `historical / as_of / compare / freshness_sensitive / live_assisted` 是
  plan-level query mode，不是 step type
- `historical / as_of` 通过 `version_query` 与 `historical_version_lookup` step 收口
- `compare` 通过 `compare_pair_lookup` 与后续 merge / evidence selection 收口
- `freshness_sensitive` 先走 `freshness_gate`，不能跳过 freshness admission
- `live_assisted` 只表示“允许在 admitted 条件下进入 bounded live branch”，不表示 `knowledge`
  可以自动挑选 live target
- `allow_live_source_lookup=true` 只表示 branch admission；具体 live target selection
  仍由上层 admitted runtime / tool path 冻结，不属于 `knowledge` collection runtime
  profile truth

## StepResult

`StepResult` 的最小稳定 shape 固定为：

```text
StepResult
- step_id: str
- run_step_id: str
- status:
  - succeeded
  - empty
  - blocked
  - failed
- grounding[]: step-level candidate payload
- references[]: stable canonical references
- activity: compact step execution summary
- failure: null | terminal/non-terminal failure record
- stage_attribution: str
```

固定规则：

- `grounding` 用于后续 synthesis / supporting-evidence selection
- `references` 必须指向稳定 canonical units，而不是 raw trace id
- `activity` 用于 operator / eval / audit，不直接暴露 raw vendor payload
- `failure` 只记录 bounded retrieval failure，不替代 top-level app error model
- `StepResult` 的详细逻辑对象定义见 `docs/data/retrieval-query-activity-model.md`
- `stage_attribution` 必须可映射到 badcase / RAGAS / golden dataset / panel 的同一阶段词汇

## Planner And Executor Boundary

### `knowledge` planner 固定负责

- query framing 后的 query mode 决定
- admitted scopes 内的 step 排布
- selector narrowing intent
- 是否触发 bounded replan
- supporting evidence selection policy
- evidence coverage decision 和 synthesis / grounding policy

### `retrieval-core` executor 固定负责

- step 到 executor kernel request 的映射
- authz / visibility / version / runtime-profile enforcement
- step execution
- rerank / threshold / merge / dedupe
- `StepResult.activity` 与 candidate shaping

### typed domain tools 固定负责

- projection-backed deterministic data access
- typed tool result schema
- source truth / release current pointer / visibility posture enforcement

固定约束：

- planner 不得静默扩大 scope、trust tier 或 runtime capability
- executor 不得静默改写 query mode、历史语义或产品 capability
- `RetrievalRequest` 继续是 executor kernel input；它可以从 `RetrievalStep` 派生，但两者不
  允许一一直接等号化
- evidence verifier 失败时必须 replan、clarification 或 fail-close；synthesis 不得把缺失证据补成自然语言答案

## Budget, Replan, And Fail-Close

固定 budget 语义：

- plan budget
  - `max_steps`
  - `max_replans`
  - `max_live_lookups`
- step budget
  - `top_k`
  - `timeout_ms`

固定 bounded replan 语义：

- replan 只能由 `knowledge` 发起
- replan 只允许在以下分支触发：
  - step `empty`
  - non-terminal `blocked`
  - 需要更窄 selector / query rewrite
- replan 后仍必须满足：
  - admitted scope 不变或收窄
  - authz / visibility gate 不变
  - source-trust policy 不放宽
  - tool family 不切换成 structured runtime 或 general web

固定 fail-close 分支：

- budget exhausted
- unresolved freshness
- no admitted live branch
- no answer-bearing supporting evidence
- evidence coverage failed
- grounding failed
- unauthorized or runtime-profile-blocked scope

## Browser / Supervisor Safe Boundary

以下字段不得直接成为 browser / supervisor-facing contract：

- raw `RetrievalPlan`
- raw `RetrievalStep`
- raw step query text history
- raw vendor scores / payload
- raw candidate trace dump
- raw durable step payload

browser / supervisor 允许消费的只是：

- supporting evidence
- source card / canonical reader jump target
- operator-safe execution summary
- sanitized step trajectory summary

## Forbidden Shapes

- 不把 `RagRetrievalPlan = default_rewrite | personalized_rewrite` 误写成长期 retrieval
  plan truth
- 不把 `RetrievalRequest` 直接冒充成 `RetrievalStep`
- 不把 `live_source_lookup` 做成 general web fallback
- 不把 structured runtime tool family 混入 generic retrieval step taxonomy
- 不把 fail-close 降成“无依据也尽量回答”

## 相关稳定文档

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/data/retrieval-query-activity-model.md`

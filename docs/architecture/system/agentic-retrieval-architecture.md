---
doc_type: architecture
truth_scope: capability
owner_boundary: packages/knowledge-capability
status: active
created: 2026-04-20
updated: 2026-06-14
---
# Agentic Retrieval Architecture

## 文档边界

本文冻结 `campus-agent` 长期目标中的 agentic retrieval supporting architecture。

它回答的是：

- durable planner-first typed-tool retrieval 在本仓库里应长成什么样
- `knowledge`、`retrieval-core`、runtime truth 各自负责什么
- multi-step retrieval、freshness / live branch、query activity、durable step
  trajectory 应如何收口

它不负责：

- 当前 merged truth 是否已经完成这些能力
- 某一轮 workstream 的执行顺序
- 某个 provider / SDK / vendor API 的具体接法

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 与
`docs/architecture/system/retrieval-serving-architecture.md` 为准。本文描述的是长期 target
architecture，不得把它误读成当前已开放产品 truth。

## Core Conclusion

`campus-agent` 的 retrieval 目标不是继续停留在 single-shot hybrid query，而是：

`durable planner-first typed-tool agentic RAG`

它的固定形态是：

- planner-first
- typed retrieval plan
- Temporal-backed durable step graph execution
- typed retrieval / domain tools
- evidence verifier
- explicit freshness / historical routing
- answer-bearing evidence 与 raw candidate trace 分层
- step-level latency / token / cost / grounding evidence projection
- fail-close by default

它仍然不是：

- 开放域 general web fallback
- prompt 内隐式工具调用黑盒
- 让 retrieval backend 自行决定产品 scope 的自治代理
- 把 service status、transport schedule、canonical notice reading 这类结构化当前状态问题强行塞进
  retrieval planner
- 把 `knowledge` 重新变成所有 campus capability 的默认 fallback 或 hidden mega-agent

## Why Agentic Retrieval Exists Here

长期引入 agentic retrieval 的原因固定为：

- 用户问题会跨条款、跨培养方案层级、跨说明页与近期信息
- `current / historical / as_of / compare / freshness-sensitive` 问题不适合继续压成一次检索
- campus assistant 需要更强的 query planning，但不能牺牲 query-enabled surface、
  source-trust 与 fail-close

因此本仓库的 agentic retrieval 目标始终是：

- 在 institution-scoped campus assistant 内提升 retrieval planning 能力
- 不把产品边界扩写成开放域问答

同时固定保留一个并列结论：

- `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`
  与 internal selected notice resolve（`payload_kind=campus_notice_get`）这类结构化
  runtime capability 不属于 retrieval-core 本身
- 它们应通过 projection-backed internal query service + typed domain tool 提供；只有需要语义判断时
  才进入 agent-as-tool
- `knowledge` 可以消费这些 typed domain tool / agent-as-tool 产出的 bounded context projection，但不能代持它们的
  source truth、temporal semantics 或 opening gate

## Long-Term Execution Shape

主链路中的 RAG 片段固定为：

```text
Execution Agent Layer typed step admission
-> Temporal workflow activity
-> knowledge planner
-> typed retrieval/domain activities
-> retrieval-core executor / domain query service
-> evidence verifier
-> supporting evidence selection
-> knowledge synthesis
-> evidence integrity verification
-> execution finalization
```

其中：

- Execution Agent Layer 负责 capability / policy / top-level routing admission
- `knowledge` 负责 plan 与 answer 语义
- `retrieval-core` 负责 retrieval execution，不拥有产品级 scope 决策
- Temporal execution plane 负责 workflow/activity retry、timeout、heartbeat 与 dispatch；
  repo-owned projection 负责 step attempt、result、event 与 eval/panel truth
- evidence contract 驱动 replan / clarification / fail-close；synthesis 不得补洞
- 当前实现中的 Temporal-visible RAG 已拆成
  `rag.plan`、`retrieval.indexed_lookup`、`retrieval.expand_or_rescue`、
  `evidence.selection`、`synthesis`、`grounding.verify`、`finalization.write` 等
  durable steps；后续优化重点是让每个 step 的 evidence、latency、token/cost、
  cancel/timeout 与 evidence-integrity verdict 更可证明，而不是恢复 coarse activity

当 retrieval 处于 multi-capability / agent-as-tool workflow 中时，长期片段固定为：

`upstream typed tool / agent-as-tool StepOutputProjection -> knowledge context
framing -> typed retrieval plan -> retrieval/domain tools -> evidence verifier ->
supporting evidence -> evidence integrity verification -> execution finalization`

允许进入 `knowledge` 的 upstream context 必须是 bounded projection，例如
`CanonicalNoticeContext`、`NoticeChangeSet`、`ServiceGuideFacts`、`ScheduleBaseline`
或 `PlaceContext`。这些 projection 只能作为 retrieval framing / evidence comparison
input，不得绕过 query-enabled surface、freshness gate 或 source-trust gate。

## Ownership Model

### `packages/knowledge-capability`

长期负责：

- resolved scope / query mode 解析
- retrieval plan 生成
- replan decision
- supporting evidence selection policy
- grounded answer synthesis
- evidence verifier / grounding validator policy

不负责：

- product account / session truth
- runtime profile 的最终 owner 决策
- retrieval backend vendor freeze

### `packages/retrieval-core`

长期负责：

- retrieval step execution
- per-step metadata filter enforcement
- rerank / threshold / merge / dedupe
- query activity / execution metadata
- candidate set shaping
- typed retrieval tool execution projection

不负责：

- 隐式扩面到未开放 collection
- 在无 planner truth 时自猜历史语义、freshness 语义或产品 capability

### runtime truth owners

- `apps/app-api`
  - account / session projection、operator-facing read model
- runtime profile / registry / release truth
  - collection posture、visibility、serving alias、version mode
- `execution-control` / current `apps/execution-control`
  - policy / capability admission
  - workflow/activity admission
  - projection command and finalization
- Temporal execution plane
  - workflow history、task queue、retry、timeout、heartbeat 与 worker dispatch

## RetrievalPlan

`RetrievalPlan` 固定是 typed contract，而不是 prompt 内部不可见的推理副作用。

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
- corresponding durable `RunStep` ids
- plan budget
- source-trust / freshness requirements
- fail-close condition

固定规则：

- plan 只能引用 admitted step types
- plan 不能扩大 query-enabled surface
- plan 不能绕过 query-enabled surface、source gate 或 runtime profile

## RetrievalStep

每个 `RetrievalStep` 都必须映射到 typed、可追溯、可观测的 durable `RunStep`。

每个 step 至少应表达：

- `step_id`
- `step_type`
- target scope
- normalized query
- metadata / version / source filter
- freshness requirement
- expected output class
- step budget
- durable stage attribution

stage attribution 固定使用：

- `planning`
- `tool`
- `retrieval`
- `rerank`
- `selection`
- `synthesis`
- `grounding`

## Allowed Step Types

admitted retrieval/domain tool step types 固定优先包括：

- `hybrid_search`
  - 面向单一 admitted collection 的普通索引检索
- `document_section_read`
  - 读取 canonical document section / root unit
- `parent_context_expand`
  - 在 admitted document 内扩展 parent/child context
- `rerank`
  - 对候选集合执行 admitted rerank profile
- `evidence_coverage_verify`
  - 检查 supporting evidence 是否覆盖问题要求
- `supporting_evidence_select`
  - 从 candidate set 中选择 answer-bearing evidence
- `entity_resolution`
  - 面向课程、方案家族、制度对象、地点等实体分辨
- `scope_follow_up`
  - 在已 admitted 的 capability 内切换到 internal retrieval surface
  - 只保留给显式 admission 的扩展；未 admission 时 executor 必须拒绝它
- `historical_version_lookup`
  - 显式 historical / `as_of` 版本定位
- `compare_pair_lookup`
  - 为 compare 查询准备双侧 evidence
- `freshness_gate`
  - 判断近期/最新语义是否允许继续回答
- `live_source_lookup`
  - 只允许命中 repo admitted 的 live source channel

禁止新增：

- general web browse fallback
- 未经 repo 文档 admission 的 remote capability
- 以 provider 内置黑盒 web tool 替代 repo-owned source truth

## Plan Lifecycle

plan lifecycle 固定为：

1. query framing
1. policy / scope / source admission
1. query mode resolution
1. plan emission
1. step execution
1. optional bounded replan
1. candidate merge / rerank / threshold
1. supporting evidence selection
1. evidence coverage verify
1. synthesis
1. evidence-integrity verification

## Budget Model

planner / executor 必须显式拥有 budget truth。

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

## Surface, Freshness, Source-Trust Gates

agentic RAG 不是对当前 gate 的替代，而是必须显式经过这些 gate：

- serving-surface gate
- query-enabled surface gate
- version-mode gate
- freshness gate
- source-trust gate

固定规则：

- planner 不能把 `offline_preparation` surface 当作默认可答 surface
- freshness-sensitive query 在 local freshness 不足时，只能走 admitted live branch 或
  fail-close
- 低信任 remote evidence 不能直接成为 answer-bearing evidence

## Candidate Set Vs Supporting Evidence

固定区分两层 truth：

- `candidate set`
  - planner / executor 在各 step 中看到的原始候选集合
- `supporting evidence`
  - 最终允许进入回答的 answer-bearing evidence

固定规则：

- supporting evidence 必须是 candidate set 的受控子集
- raw candidate trace 属于 execution / observability truth，不等于最终 answer truth
- 不能把“召回过”直接等同于“可支持回答”

## Rerank, Merge, And Dedupe

`retrieval-core` 可以执行：

- rerank
- thresholding
- duplicate collapse
- cross-step merge
- title / entity / version-aware dedupe

当前代码事实是：online rerank 主要依赖 Qdrant hybrid / RRF、heuristic ranking 与
profile-gated rerank interface；未发现线上 cross-encoder、torch、ONNX 或
sentence-transformers rerank 已接入为 current serving truth。后续是否引入
cross-encoder / complex scoring 必须先由 step-level latency、CPU profile、
quality eval 与 cost evidence 证明，不能作为默认假设。

但它不能：

- 改写产品 scope
- 静默抹平 historical / current 差异
- 把 archive/historical 结果偷塞回当前默认答案

## Historical, Compare, And Freshness-Sensitive Queries

query mode 固定显式化：

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

agentic RAG 固定 fail-close 于以下分支：

- no admitted plan
- unauthorized target scope
- unsupported query mode
- insufficient freshness
- insufficient answer-bearing evidence
- evidence coverage verification failed
- evidence-integrity verification failed
- semantic grounding validation failed, only when a badcase/eval-driven hardening
  lane explicitly opens claim-level verification
- planner / executor budget exhausted
- live branch unavailable

## Observability And Query Activity

至少保留以下 step-level RAG execution truth：

- plan summary
- step count
- step latency
- step outcome
- replan count
- tool result summary
- rerank summary
- merge / dedupe summary
- final supporting evidence summary
- evidence coverage verdict
- synthesis summary
- grounding verdict
- freshness branch outcome
- live retrieval outcome
- provider request ref、latency、input / output / cached token、estimated cost
- cancel / timeout observed outcome

这些 execution-side truth 用于 operator observability、quality grading 与 release
gate， 但不应直接暴露 raw snippets 或 vendor payload。

badcase、RAGAS、golden dataset 与 operator panel 的阶段归因固定落到：

- `routing`
- `planning`
- `tool`
- `retrieval`
- `rerank`
- `selection`
- `synthesis`
- `grounding`

低分样本必须能回链到 sanitized step trajectory；不得只保留最终 answer 文本和一组 raw logs。

## Prove-The-Answer Contract

RAG 目标不是只返回一个看起来合理的 answer，而是为每个关键阶段留下可诊断证据：

- retrieval step 必须投影 admitted query、filters、candidate summary 与 bounded query activity。
- selection step 必须投影 supporting evidence id、span、coverage summary 与 reject reason。
- synthesis step 必须投影 provider request ref、latency、token、estimated cost 与
  synthesis contract；不得把 raw provider response 作为 canonical truth。
- `grounding.verify` 当前在线语义是 evidence-integrity verification：必须投影
  `verification_kind=evidence_integrity`、synthesis/evidence ref 一致性、answer text
  presence、source ref count 与 fail-close reason。
- claim / list item semantic grounding 是后续 hardening lane；只有 badcase / eval
  证明当前 evidence-integrity 不足时，才提升为 Go RAG semantic verification 工作。
- finalization 只能消费已通过 evidence-integrity verification 的 supporting evidence
  projection。

如果缺少 retrieval result、supporting evidence、usage/cost accounting、
evidence-integrity verdict 或 cancel outcome，run 不能被标记为“可证明地答”；只能作为诊断缺口或
fail-close 分支进入 projection。

## LlamaIndex Boundary

LlamaIndex 是 ingestion / retrieval implementation dependency，不是 `campus-agent`
架构层。

固定规则：

- LlamaIndex 不能进入 `packages/contracts`、`apps/execution-control`、panel / eval canonical
  truth 或架构 vocabulary。
- ingestion / retrieval adapter 可以在内部使用 LlamaIndex 做 chunking、embedding helper、
  metadata helper 或 Qdrant integration glue，但跨层 contract 必须是 repo-owned DTO。
- 长期 online retrieval boundary 收口为 repo-owned DTO + Qdrant native adapter + sanitized
  query activity projection；LlamaIndex 只能保留为可替换实现依赖。
- eval、operator panel 与 badcase 只看 durable step/result projection，不以
  LlamaIndex run object、node object 或 vendor metadata 作为 source truth。

## Internal Agents SDK Loop

`knowledge` 可以在 deterministic scope/version/preflight、retrieval plan、retrieval
execution 与 supporting evidence selection 之后使用官方 OpenAI Agents SDK 作为内部 semantic
loop runtime。该 SDK loop 只替代或补强 answer synthesis / structured output / internal
guardrail ergonomics，不拥有 retrieval truth。

固定规则：

- SDK runner 输入只能是 repo-owned `RagSdkRunRequest`、query intent、
  admitted query slot ids 与 bounded evidence anchors
- SDK function tool 不能执行新的 backend retrieval、不能改写 selector、不能扩大 scope /
  version / serving surface；默认只能选择已 admitted query slot
- bounded semantic replan 若后续打开，必须有显式 budget、reason、trace 和 no-widening gate
- output guardrail 必须拒绝 forged source id、missing claim support、source-id-only support、
  uncited list item 与 malformed structured output
- no evidence、timeout、runtime failure、guardrail failure、malformed output 均
  fail-closed 为 unsupported/no-answer，不得回落成无观测的第二 primary synthesis path
- category discovery 例如“有哪些本科生可以申请的奖学金”可以由 RAG 内部 query intent 表达并返回
  cited list answer；服务/身份流程类问题例如“门户密码忘了怎么办”保持 routing-negative /
  unsupported-scope eval boundary，不交给 RAG 兜底

SDK loop 的验收口径固定为产品 contract，而不是 provider run success：

- Python SDK suite 只覆盖 offline/eval/historical bridge behavior，不作为 online RAG
  serving acceptance
- public/chat product-path E2E 必须证明
  `execution-control -> Temporal context memory -> activity-worker-agent /
  agent-runtime primary agent -> knowledge_query workflow signal ->
  admitted knowledge RAG graph ->
  activity-worker-knowledge -> activity-worker-finalization -> sanitized
  projection -> app-api` 返回 canonical product response
- real-provider E2E 只有在本地/部署 Docker runtime 健康时才可作为 acceptance evidence；
  Docker daemon / WSL backend failure 只能记录为 environment blocker
- SDK native tracing 上游默认可记录 LLM generation、function tool、handoff 与 guardrail span；
  本 repo 默认关闭 native trace，只允许 repo-owned sanitized projection 出边界

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
- `docs/architecture/system/execution-agent-layer-architecture.md`
- `docs/architecture/system/tool-and-capability-runtime-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/knowledge-retrieval-plan-contract.md`
- `docs/data/retrieval-query-activity-model.md`
- `docs/reference/runtime-serving-and-index-terms.md`

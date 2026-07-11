---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0004
status: accepted
created: 2026-03-22
updated: 2026-06-12
---
# ADR-0004 评测指标体系

适用范围：`campus-agent` v2 中 repo-owned retrieval、answer、workflow 与 gate 指标。
ADR-0061 已将旧 `packages/evals` package 退役，当前 Langfuse-bound eval artifacts 由
`packages/eval-langfuse` 承接。

## 目标

为 `campus-agent` 冻结长期评测指标体系，明确哪些指标家族属于正式门禁对象、它们分别对应哪一层真值，以及哪些内容不应在长期 ADR 中提前写死。

这份 ADR 解决的是“评什么”，不是“这轮阈值是多少”或“具体用哪一个库去算”。

## 非目标

本 ADR 不冻结以下内容：

- 某次迭代的 `k` 取值
- 某个 split 的 pass threshold 或 CI gate 数值
- 具体 scorer 的 prompt、模型或 provider
- 某个阶段的 dashboard、报表或告警实现

这些内容应进入实施计划、配置文件或运行时策略，而不是写死在长期治理 ADR 中。

## 决策 1：指标按真值层分组，而不是追求单一总分

`campus-agent` 的正式指标体系至少拆成以下四层：

- retrieval metrics
- answer metrics
- workflow metrics
- safety and gate metrics

长期上不使用单一“总体质量分”代替分层指标，因为 agentic RAG 的失败往往发生在不同层次，单一总分会掩盖边界错误。

## 决策 2：Retrieval 的核心指标族

retrieval 层长期至少保留以下指标族：

- `Hit@K` 判断 top-k 是否至少命中一个期望 source
- `Recall@K` 判断 top-k 覆盖了多少期望 source
- `Precision@K` 判断 top-k 中有多少 source 实际相关
- rank-aware retrieval metric 长期至少保留一类排序敏感指标，优先用于衡量相关 source 是否被排到前面

其中：

- `Hit@K` 适合做 smoke 与快速门禁
- `Recall@K` 与 `Precision@K` 是 retrieval truth 的核心正式指标
- rank-aware 指标可以采用 `MRR`、`nDCG` 或其他等价排序指标，但具体实现不在本 ADR 中冻结

`K` 的具体取值属于阶段性实施问题，不在本 ADR 中写死。

## 决策 3：Answer 的核心指标族

answer 层长期至少保留以下指标族：

- `Faithfulness` / groundedness 判断回答中的 claim 是否能由 retrieved context 支撑
- factual correctness / answer accuracy 判断回答与 reference truth 或 required facts
  的一致性
- answer completeness 判断 required facts 是否被覆盖
- forbidden-claim rate 判断回答是否包含不允许出现的断言

其中：

- `faithfulness` 解决“有没有编造”
- factual correctness / answer accuracy 解决“答得对不对”
- completeness 解决“是不是漏答了关键点”
- forbidden-claim rate 解决“有没有越界或错误补全”

长期不把 `faithfulness` 当作 answer 质量的唯一指标，因为“没编造”不等于“回答正确或完整”。

## 决策 4：Workflow 的核心指标族

对 `Execution Agent Layer -> OpenAI Agents SDK -> function tool / handoff` 这类 agentic
workflow，长期至少保留以下指标族：

- `status accuracy` `completed`、`needs_clarification`、`no_answer`、`error` 是否与
  truth 一致
- `intent-frame accuracy` top-level intent / task framing 是否与 truth 一致
- `routing accuracy` 是否选择了正确的 SDK tool / handoff，或在不该委派时正确保持不委派
- `slot completeness / missing-slot accuracy` 是否识别出 cohort、major、campus、target
  policy 等关键缺失信息
- `clarification accuracy` 是否在应澄清时澄清，不应澄清时不误触发
- `no-answer accuracy` 是否在证据不足或范围不符时正确拒答
- `memory-context correctness` 是否正确使用 typed memory 做 follow-up、消歧、query
  framing 与措辞，且没有把 memory 当成 source truth 或 tool-opening truth
- `delegation / handoff accuracy` 是否发生了正确的 tool delegation / handoff，且没有越级绕过
  execution policy
- `trace path correctness` 是否发生了正确的 retrieval 调用、fail-closed 行为与其他关键中间路径

补充约束：

- 新 agent、新 routing 或新 handoff 在进入 `release_gate` 前，必须先具备 machine-grade trace 点
- 缺少 trace observability 的设计，视为 workflow 指标不完整，而不是“暂时不评”

workflow 指标属于正式门禁对象，不得被最终答案文本指标替代。

## 决策 5：Safety 与 Gate 指标单独保留

长期至少单独保留以下安全与门禁指标：

- tool readiness fail-closed rate
- source-truth / evidence fail-closed rate
- forbidden-source or unopened-surface retrieval rate
- memory boundary violation rate
- account / memory projection correctness
- forbidden-personal-data disclosure rate
- citation/source-locator completeness
- error-path correctness
- cancel / timeout / late-completion projection correctness

这些指标优先以确定性规则或程序化断言实现，不依赖 LLM scorer。

## 决策 6：指标与 split 的关系

不同 split 默认关注不同指标层次：

- `smoke` 优先关注 `Hit@K`、status accuracy、最小 source locator 完整性
- `regression_locked` 必须覆盖 retrieval、answer、workflow 三层正式指标
- `release_gate` 必须覆盖 retrieval、answer、workflow 与 safety/gate 指标；当本轮变化涉及新
  agent、routing、handoff、SDK function tool 或 personalization / memory projection
  时，必须显式覆盖对应维度
- `exploratory` 允许试验新指标，但试验指标不自动升级为正式门禁

split 和指标族的对应关系在长期上固定，但每个 split 的具体阈值与计算配置不在本 ADR 中冻结。

## 决策 7：实现与框架保持可替换

长期允许以下实现来源：

- 仓库自定义 deterministic metric
- `ragas` 指标
- OpenAI grader / trace grading
- 自定义 Python scorer

但长期边界固定如下：

- 指标语义先于具体工具存在
- `ragas` 可以提供 `faithfulness`、context precision/recall 等实现，但不决定仓库的指标体系
- OpenAI grader 可以提供 factual correctness、rubric scoring 或 trace
  grading，但不决定仓库的指标分组与 gate 结构
- OpenAI trace grading 可以作为 routing、delegation / handoff、tool-path
  评估实现，但不决定仓库 workflow / safety 指标语义
- 如果多个框架都能计算同一指标族，应以仓库自己的 truth 协议为准，而不是以某个框架的默认列名或输入形状为准

## 决策 8：长期不冻结阈值，只冻结指标家族

长期 ADR 只冻结指标家族与层级关系，不冻结：

- `k`
- target score
- pass threshold
- warning threshold
- merge gate threshold

这些数值必须根据 corpus、流量分布、线上 incident 与标注成熟度迭代调整。

## 决策 9：文档分层关系

- `docs/architecture/target.md` 只保留 `evals` 边界与可替换性原则
- `docs/decisions/adr-0003-golden-dataset-governance.md` 负责 golden dataset 的真值治理
- `./adr-0015-user-identity-memory-and-personalization-boundaries.md`
  负责 identity / memory / personalization 的长期边界
- 本 ADR 负责指标家族、指标分层与 gate 语义
- `.planning/WORKSTREAMS.md` 与 `GSD SDK / Codex native session state` 负责当前阶段的
  metric wiring、阈值、runner 与报表实现

换句话说，golden dataset ADR 定义“真值长什么样”，本 ADR
定义“围绕这些真值评什么”，实施计划才回答“这一轮怎么算、用哪个配置、门禁卡在哪”。

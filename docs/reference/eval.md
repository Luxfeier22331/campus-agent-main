---
doc_type: reference
owner_boundary: packages/eval-langfuse
status: active
---

# 评测

## 当前形态

- `packages/eval-langfuse` 是 TypeScript 平台适配器和数据集所有者；
- `packages/ragas-runner` 是唯一 Python 包，只作为 Ragas 官方指标的窄适配器；Python 不参与
  在线回答、检索、采集或通用评测编排；
- Langfuse 拥有 dataset、experiment、score、annotation queue 和分析；
- Temporal 运行真实产品请求，所属 app/package 测试拥有确定性合同；
- 仓库不维护第二套 experiment、annotation 或 release-gate 框架。

`eval-langfuse` 的标准 `test` 和 `ragas-runner` 的 `test:eval` 只运行本地适配器与 scorer 测试，
不调用外部模型，也不证明发布质量。

## 观测来源

1. execution-control 的 `agent_runtime_eval_projection.v3` 提供答案、检索上下文、文档 ID 和
   `tool_trajectory.v3`；
2. Langfuse trace 提供相关联的 SDK 和模型观测；
3. `agent-eval` 通过真实 app-api 路径执行 Langfuse dataset item，并将目标 turn 关联到真实
   product trace；
4. 仓库 `cases.v1.json` 提供 reference、context ID、文档范围、最少相关上下文、outcome 和真实工具预期。

安全评测投影不从 raw provider payload、未裁剪 prompt 或私有 trace 正文反推合同事实。

## 指标

RAG 默认使用 Ragas 0.4.x collections API 的：

- `Faithfulness`
- `AnswerRelevancy`
- `ContextPrecision`
- `ContextRecall`

`context_precision_without_reference` 只在配置启用时使用。Ragas 公共 API 没有基于 context ID
的 precision/recall；仓库不得用自研指标冒充 `ragas.*`。

Agent/tool 评测使用：

- `ToolCallAccuracy`
- `ToolCallF1`
- 可选 `AgentGoalAccuracyWithReference`

工具调用来自 `tool_trajectory.v3`，只覆盖当前真实 SDK 工具。Campus Docs 检索不生成工具调用或
评测安全参数；用户原始 query 不写入 score metadata。

仓库另发布两个确定性 score：

- `execution.outcome_match`
- `retrieval.forbidden_context_absent`

所有 score 名必须先登记在 Langfuse score registry。

## 数据集

Primary Agent 路由使用 `campus/agent/routing`，并与当前工具 exposure 保持一致。当前覆盖直接回答、
基于 Campus Docs evidence 的课程与规章回答、跟进、多意图、过期上下文和 prompt injection。文档案例不期待函数
工具调用。

RAG 数据集包括：

- `campus/rag/student_rules`
- `campus/rag/institutional_rules`
- `campus/rag/curriculum`
- `campus/rag/cross_target`

RAG 数据集评估当前 Campus Docs 索引的召回、上下文和依据质量；它们不派生工具预期。

每个数据集由一个 `cases.v1.json` 维护。用例规范见 `eval-cases.md`。

## 编排评测

当前评测至少回答以下问题：

- 普通任务是否能在检索上下文无关或为空时直接完成，而不伪造引用；
- 机构事实回答是否只使用本轮依据，而没有依赖模型记忆直接回答；
- 一次 dense embedding 与 sparse query 是否通过单一 collection 的混合查询形成有界且相关的
  evidence；
- 用户问题的必要分面是否都有答案或明确的证据缺口；
- 关键机构主张是否由本轮正式依据支持，引用是否正确且完整；
- 检索错误与生成错误能否分别定位；
- 检索上下文与来源类别覆盖是否符合用例；
- `campus_docs.retrieve_ms` 及 embedding、query、selection 子阶段、Provider 首 token、真实工具轮次和完整响应延迟是否满足预算。

问题覆盖和引用完整度需要由版本化用例与少量人工评审校准。自动评审可以辅助分析，但不能把单个
LLM judge 或聚合分数作为发布结论。新指标必须先确认上游定义、接入正式适配器并登记 score 名，
不能在尚未实现时复用 `ragas.*` 名称。

## 观测、预期基准、评分与落点

| 关注点 | 观测 | 预期基准 | 评分器 | 落点 |
| --- | --- | --- | --- | --- |
| Agent 工具序列 | `tool_calls[]` | routing dataset | Ragas tool metrics | Langfuse `ragas.tool_call_*` |
| Campus Docs 来源类别与覆盖 | RAG eval projection | 来源类别/context 预期 | context metrics | Langfuse |
| 答案忠实度 | 答案和检索上下文 | reference | `Faithfulness` | Langfuse |
| 答案相关性 | 问题和答案 | dataset question | `AnswerRelevancy` | Langfuse |
| 上下文质量 | 问题、reference、上下文 | reference/context IDs | context metrics | Langfuse |
| Agent 目标 | 消息和终态 | expected outcome | 可选 goal accuracy | Langfuse |
| 产品终态 | terminal kind | `expected_outcome` | 确定性相等 | `execution.outcome_match` |
| 禁止上下文 | retrieved IDs | `forbidden_context_ids` | 确定性缺席检查 | `retrieval.forbidden_context_absent` |
| 合同完整性 | 终态与工具投影 | 所属合同 | 运行时测试 | 所属测试 |

授权、取消、超时、schema 严格性和 source ref 校验必须留在所属 runtime 测试，不能交给 LLM
judge。

在线实现不调用外部 reranker。评测应以 Qdrant dense+sparse RRF 为检索排序基线，比较上下文覆盖、引用
支持和延迟；Qdrant 查询分数不作为答案置信度，也不因此新增第二套 score registry 或发布门禁。

Agent dataset 只有在用例提供 `reference_context_ids` 或 `reference_contexts` 时才生成 RAGAS 样本。
是否实际召回到上下文不决定用例适用性，否则普通任务偶然命中文档会被误分类为 RAG 用例。

## 平台边界

真实产品请求已经产生 canonical trace，因此 runner 不使用 Langfuse `runExperiment` 创建第二条
合成 trace。它通过官方 dataset-run-item API 建立关联，并保留 Langfuse 返回的 run identity。

每个 score 只指向一个 observation 或 trace；dataset item/run ID 是 lineage，不是 score target。
缺失、`NaN` 和无穷值不会发布为 JSON score。

Langfuse、Ragas 或 score 不可用不阻塞在线回答。app-api 和 Ops Web 不镜像 Langfuse
score、dataset 或 annotation 状态。

## 禁止形态

- 恢复 broad Python eval 或自研 experiment orchestration；
- 把单个 Ragas score 当作发布结论；
- 在 upstream 名称下实现私有指标；
- 在安全 sample 或 score metadata 中保存 prompt、聊天全文、source body、provider response、
  auth material 或本地/对象存储路径。

## 相关文档

- `eval-cases.md`
- `../contracts/tool-trajectory.md`
- `../contracts/langfuse-runtime.md`
- `../runbooks/ragas.md`
- `agent-orchestration.md`
- `../decisions/adr-0003-golden-datasets.md`
- `../decisions/adr-0004-evaluation-metrics.md`
- `../decisions/adr-0061-eval-runtime.md`

---
doc_type: reference
owner_boundary: packages/eval-langfuse
status: active
---

# 评测

## 当前形态

- `packages/eval-langfuse` 是 TypeScript 平台适配器和数据集所有者；
- `packages/ragas-runner` 是唯一 Python 评测包，只调用 Ragas 官方指标；
- Langfuse 拥有 dataset、experiment、score、annotation queue 和分析；
- Temporal 运行真实产品请求，所属 app/package 测试拥有确定性合同；
- 仓库不维护第二套 experiment、annotation 或 release-gate 框架。

`pnpm ci:eval` 只运行本地适配器和 scorer 测试，不调用外部模型，也不证明发布质量。

## 观测来源

1. execution-control 的 `agent_runtime_eval_projection.v2` 提供答案、检索上下文、文档 ID、
   已解析 target 和 `tool_trajectory.v2`；
2. Langfuse trace 提供相关联的 SDK 和模型观测；
3. `agent-eval` 通过真实 app-api 路径执行 Langfuse dataset item，并将目标 turn 关联到真实
   product trace；
4. 仓库 `cases.v1.json` 提供 reference、context ID、target、outcome、history mode 和搜索预算。

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

工具调用来自 `tool_trajectory.v2`。参数评测只允许稳定且适合评测的 `target` 和
`include_history`，不把用户原始 query 写入 score metadata。

仓库另发布两个确定性 BOOLEAN score：

- `execution.outcome_match`
- `retrieval.forbidden_context_absent`

所有 score 名必须先登记在 Langfuse score registry。

## 数据集

Primary Agent 路由使用 `campus/agent/routing`，覆盖直接回答、班车工具、Knowledge Agent
handoff、target 选择、跟进、多意图、关闭来源、过期上下文和 prompt injection。

RAG 数据集包括：

- `campus/rag/student_rules`
- `campus/rag/institutional_rules`
- `campus/rag/curriculum`
- `campus/rag/cross_target`

每个数据集由一个 `cases.v1.json` 维护。用例规范见 `eval-cases.md`。

## 观测、真相、评分与落点

| 关注点 | 观测 | 真相 | 评分器 | 落点 |
| --- | --- | --- | --- | --- |
| Primary 工具选择 | public tool trajectory | routing dataset | Ragas tool metrics | Langfuse `ragas.tool_call_*` |
| 知识搜索顺序 | internal tool calls | target/history/search count | 参数感知 tool metrics | Langfuse `ragas.tool_call_*` |
| 答案忠实度 | 答案和检索上下文 | reference | `Faithfulness` | Langfuse |
| 答案相关性 | 问题和答案 | dataset question | `AnswerRelevancy` | Langfuse |
| 上下文质量 | 问题、reference、上下文 | reference/context IDs | context metrics | Langfuse |
| Agent 目标 | 消息和终态 | expected outcome | 可选 goal accuracy | Langfuse |
| 产品终态 | terminal kind | `expected_outcome` | 确定性相等 | `execution.outcome_match` |
| 禁止上下文 | retrieved IDs | `forbidden_context_ids` | 确定性缺席检查 | `retrieval.forbidden_context_absent` |
| 合同完整性 | finalization/search projection | owner contract | runtime tests | 所属测试 |

授权、取消、超时、schema 严格性和 source ref 校验必须留在所属 runtime 测试，不能交给 LLM
judge。

## 平台边界

真实产品请求已经产生 canonical trace，因此 runner 不使用 Langfuse `runExperiment` 创建第二条
合成 trace。它通过官方 dataset-run-item API 建立关联，并保留 Langfuse 返回的 run identity。

每个 score 只指向一个 observation 或 trace；dataset item/run ID 是 lineage，不是 score target。
缺失、`NaN` 和无穷值不会发布为 JSON score。

Langfuse、Ragas 或 score 不可用不阻塞在线回答。app-api 和 Operator Console 不镜像 Langfuse
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
- `../architecture/system/langfuse.md`
- `../runbooks/ragas.md`

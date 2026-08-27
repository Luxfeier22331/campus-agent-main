---
doc_type: reference
owner_boundary: packages/eval-langfuse
status: active
---

# 评测

## 当前形态

- `packages/eval-langfuse` 负责 Agent 用例解析、产品路径评测、Ragas 输入适配、可选 score 发布和
  在线 trace 校验；
- `packages/ragas-runner` 是唯一 Python 包，只调用 Ragas 官方指标；
- 离线 Ragas 直接消费本地 JSON，不连接 Langfuse，不读取 trace，不选择数据集；
- Langfuse 只承载在线 trace 和调用方按需发布的 score，不是评测输入来源；
- 仓库不维护 dataset 同步、第二套报告、评测数据库或 release gate 系统。

本地 `test` 和 `test:eval` 只验证适配器与合同，不调用外部模型，也不证明模型或索引质量。

## 权威来源

评测命令消费调用方显式提供的输入。需要长期复用的输入可以来自仓库文件或私有对象存储，一次性输入
也可以只在本地提供。当前仓库 Agent 用例位于
`packages/eval-langfuse/assets/agent/routing/cases.v1.json`。Langfuse 上的 trace、score 和反馈不能
自动改写这些输入。
`agent-eval` 通过真实 App API 执行这些用例，并从 execution-control 的受认证内部接口读取
`agent_runtime_eval_projection.v4` 中的答案、检索上下文和 `tool_trajectory.v4`。Campus Docs 上下文只
来自真实 `campus_search` tool result 的闭包；Langfuse trace 只提供相关联的 SDK 和模型观测。

线上 trace 只保存受控关联、模型/工具名称、用量、耗时和有限状态，不保存 answer、prompt、对话、
retrieval 正文、工具参数或 provider 原始响应。因此 Ragas 不从普通 trace 反查
正文。

## Ragas 输入合同

样本批次使用 `ragas_sample_batch.v3`：

```json
{
  "schema_version": "ragas_sample_batch.v3",
  "items": [
    {
      "case_id": "library-hours",
      "user_input": "图书馆开放时间是什么？",
      "response": "图书馆开放时间为 08:00 到 22:00。",
      "retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
      "reference": "图书馆开放时间为 08:00-22:00。",
      "metadata": {"surface_key": "app-api.chat"}
    }
  ]
}
```

单条样本只包含 `case_id`、`user_input`、`response`、`retrieved_contexts`、可选 `reference` 和
标量 `metadata`。不得放入 trace、observation、dataset run、context ID、凭据、本地路径或原始正文
之外的运行 dump。空 `retrieved_contexts` 是有效的失败样本，不能因此丢弃整批评测。

评分结果使用 `ragas_score_batch.v3`，只保留每个 `case_id` 的 `scores` 和实际评分错误，不携带
产品请求或 Langfuse 身份。缺少 reference 时不运行 `context_precision` 和 `context_recall`，不伪造零分。

默认 Ragas 指标为：

- `faithfulness`；
- `answer_relevancy`。

只有样本提供 `reference` 时才启用 `context_precision` 和 `context_recall`。不使用自研的
`context_precision_without_reference`，也不把 context ID 冒充 Ragas 指标。

## Agent 评测

`agent-eval` 通过真实 App API 执行调用方显式提供的 cases 文件，生成
`agent_product_eval_result.v2`。随后 `score-ragas` 生成 Agent 工具样本和独立的 RAG v3 样本，
输出最终 score 文件。发布到 Langfuse 时，TypeScript 适配层用同一批次的显式 case-to-trace 映射
补回 score target，不把平台身份传给 Python Ragas runner。

是否生成 RAG 样本由 case 是否声明 reference context 决定，不由实际召回是否非空决定。空召回仍须
作为 RAG 失败样本进入评分。

Primary Agent 路由使用 `campus/agent/routing`，并与当前工具 exposure 保持一致。当前覆盖直接回答、
`campus_search`、个人记忆、跟进和 prompt injection。调用方需要评测 RAG 时显式提供 reference context，
不把它写成在线 Agent 的固定输入。

## Score

Langfuse score 名由 `packages/eval-langfuse/src/score-publisher.ts` 的代码级 allowlist 校验，
不再维护或同步第二份 score registry。Ragas、Agent 和确定性 score 仍各自保留明确的名称与类型。

线上反馈、trace 和人工标注不自动进入评测输入。是否用于回归、如何处理以及保存在哪里，由具体任务
决定；不需要评测输入的问题仍由所属模块建立普通修复任务。

## 平台边界

- 离线 Ragas 默认把完整结构化 score JSON 写到 stdout，也可以写入调用方指定的文件；不生成持久报告；
- Langfuse score 发布是可选的适配步骤，不是 Ragas runner 的职责；
- Langfuse、Ragas 或 score 不可用不阻塞在线回答；
- 评测结果用于定位和比较，不自动决定发布；合同测试和所属模块验证负责发布结论。

## 相关文档

- `eval-cases.md`
- `../contracts/langfuse-runtime.md`
- `../runbooks/ragas.md`
- `../decisions/adr-0003-golden-datasets.md`
- `../decisions/adr-0004-evaluation-metrics.md`
- `../decisions/adr-0076-langfuse-trace-data.md`
- `../decisions/adr-0090-eval-boundaries.md`

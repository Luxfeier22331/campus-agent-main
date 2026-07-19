---
doc_type: architecture
owner_boundary: knowledge-agent
status: active
---

# Knowledge Agent 检索

## 边界

本文定义 Knowledge Agent 如何规划有界搜索并基于依据回答。它与 Primary Agent 位于同一个
OpenAI Agents SDK run，不建立 Temporal 检索图、外部 planner、独立合成 activity 或专用队列。

工具参数和结果结构由 `../../contracts/tool-execution.md` 与可执行 function schema 维护；检索
服务实现见 `retrieval-serving.md`。

## 入口

Primary Agent 通过官方 handoff 进入 Knowledge Agent，只传递用户问题。execution-control 提供
当前可用知识目标的标识与描述；Agent 不接收 collection、Qdrant alias、embedding profile、
top-k、供应商或来源正文。

## 搜索行为

Knowledge Agent 每次选择一个已提供的知识目标并提出聚焦查询。它应在依据充分时停止；结果不足
时可以改写查询或选择另一个已提供目标。只有问题明确要求历史版本、截至日期或版本比较时，才
能请求历史内容。

execution-control 限制搜索次数并拒绝同一 run 内重复的目标、查询与历史模式组合。预算耗尽或
依据不足时，Agent 必须返回相应的结构化结果，不能用模型记忆补齐学校事实。

## 依据使用

- Agent 只能引用本次 run 中已完成搜索返回的依据；
- 回答必须携带支持其主张的依据引用；
- 个人记忆和上一轮依据只帮助理解查询，不能成为本轮正式来源；
- execution-control 在终态处理时重新核对依据引用并生成浏览器来源；
- 找不到足够依据时应澄清或明确无法支持，不能生成无依据结论。

## 评测

工具轨迹分别记录 Primary Agent handoff 和 Knowledge Agent 内部搜索。评测投影提供答案、检索
上下文、文档标识和已解析目标；精确字段由 `../../contracts/tool-trajectory.md` 和
`../../reference/eval.md` 维护。

## 相关文档

- `agent-framework.md`
- `tool-routing.md`
- `retrieval-serving.md`
- `../../contracts/tool-read-model.md`

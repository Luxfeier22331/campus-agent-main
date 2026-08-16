---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---

# 工具轨迹合同

## 边界

`tool_trajectory.v3` 是执行诊断和评测消费的真实 SDK 工具调用投影。它不是 Langfuse DTO、浏览器
合同、Temporal history 或 Provider response。

## 顶层结构

投影包含：

- `schema_version=tool_trajectory.v3`；
- request、run 与 trace 标识；
- 可选 conversation、`surface`、environment 与 release 标识；
- `available_tools`；
- `decision_kind=direct_answer|tool_assisted|fail_closed`；
- 适用时的失败关闭原因；
- 同一个 Primary Agent 实际执行的有序 `tool_calls[]`。

该投影从有界 run/step/result 数据派生，不读取原始 prompt、Provider response、Campus Docs evidence 正文或
Temporal history。

## 当前工具词汇

v3 只接受当前注册表中的名称：

- `personal_memory_recall`。

`personal_memory_recall` 只有本轮冻结授权允许时才进入 `available_tools`，并且最多产生一次调用。

培养方案和规章文档由 `campus_docs.retrieve` 检索，不是模型工具，不得派生工具调用、`tool_name`、
`eval_safe_args` 或 `selected_tool`。

## 工具调用

每次调用可以携带 tool call id、tool name、status、result kind、duration、argument shape/hash、失败
关闭原因和允许公开的 Provider/model 标识。

个人记忆 query、`memory_text`、Hindsight 标识和原始结果均不属于轨迹。记忆工具只保留参数 hash、
状态、结果种类、调用标识和耗时。

## 决策语义

- `direct_answer`：没有执行模型可见工具；即使消费了 Campus Docs evidence，仍属于直接答案；
- `tool_assisted`：至少一个已准入 SDK function tool 已执行；
- `fail_closed`：合同、配置、策略或执行条件拒绝了本次 run。

澄清、拒绝、Campus Docs 检索和普通直接回答不得伪装成工具。

## 禁止数据

trajectory 必须在写入前拒绝：

- 原始 prompt、transcript、Provider response 或 model output；
- 原始工具参数、检索 query、evidence 或 source body；
- 原始 memory content 或 Hindsight identifier；
- credential、auth header、cookie、database URL 或 object-store location。

## 评测消费

`packages/eval-langfuse` 只解析 v3。工具评测只覆盖真实 SDK 工具；答案与 RAG 质量通过 execution
eval projection 中独立的 Campus Docs 检索事实、上下文和答案字段评测。

## 可执行来源

- `apps/execution-control/internal/httpapi/tool_trajectory_projection_test.go`
- `packages/eval-langfuse/src/tool-trajectory.ts`

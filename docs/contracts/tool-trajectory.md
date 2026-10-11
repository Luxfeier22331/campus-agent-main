---
doc_type: contract
owner_boundary: apps/agent-control
status: active
---

# 工具轨迹合同

## 边界

`tool_trajectory.v4` 是评测消费的真实 SDK 本地函数工具调用投影。它不是 Langfuse DTO、浏览器
合同、Temporal history 或 Provider response。

## 顶层结构

投影包含：

- `schema_version=tool_trajectory.v4`；
- `decision_kind=direct_answer|tool_assisted|fail_closed`；
- 同一个 Primary Agent 实际执行的有序 `tool_calls[]`，每项含 `tool_name`；`campus_search`
  调用额外携带当次检索的 `search_query` 和 `search_goal`。

该投影从有界 run/step/result 数据派生，不读取原始 prompt、Provider response、知识内容或
Temporal history。

## 当前工具词汇

v4 只接受当前本地函数工具注册表中的名称：

- `campus_search`；
- `personal_memory_recall`。

`tool_calls[]` 按真实发生顺序记录。没有调用的已暴露工具不进入评测轨迹。

Agents SDK 原生 hosted `web_search` 没有本地执行结果，不进入该轨迹。其他非本地函数工具能力也不得
派生 `tool_name`、`search_query`、`search_goal` 或 `selected_tool`。

## 工具调用

每次调用必须携带 `tool_name`。`campus_search` 调用携带当次模型生成的 `search_query` 和
`search_goal`，供评测确认每次检索意图；这是模型生成的检索表达，不属于用户隐私数据。

Campus Search evidence 正文、collection 标识、provider 凭据和原始结果均不属于轨迹；个人
记忆 query、`memory_text`、Hindsight 标识和原始结果也不属于轨迹。状态、耗时、调用 ID、运行时版本
和 Provider 标识属于执行诊断，不复制进评测轨迹。

## 决策语义

- `direct_answer`：没有执行本地模型可见函数工具；仅使用 hosted `web_search` 的运行在当前本地轨迹中
  仍属于该值；
- `tool_assisted`：至少一个已准入 SDK function tool 已执行；
- `fail_closed`：合同、配置、策略或执行条件拒绝了本次请求。普通工具失败本身不要求整轮
  `fail_closed`；只要剩余事实足以形成合法终态，轨迹仍可为 `tool_assisted`。

澄清、拒绝和普通直接回答不得伪装成工具。

## 禁止数据

trajectory 必须在写入前拒绝：

- 原始 prompt、transcript、Provider response 或 model output；
- 原始工具参数、知识查询内容或 source body；
- 原始 memory content 或 Hindsight identifier；
- credential、auth header、cookie、database URL 或 object-store location。

## 评测消费

`packages/eval-langfuse` 只解析 v4。工具评测只覆盖真实 SDK 工具；离线知识评测不改变在线工具
轨迹合同。

## 可执行来源

- `apps/agent-control/internal/httpapi/tool_trajectory_projection_test.go`
- `packages/eval-langfuse/src/tool-trajectory.ts`

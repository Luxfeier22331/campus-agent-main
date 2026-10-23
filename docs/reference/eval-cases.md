---
doc_type: reference
owner_boundary: packages/inspect-eval
status: active
---

# 评测用例

用例由调用方提供，现有集合位于 `packages/inspect-eval/assets/cases.v1.json`。稳定 `case_id` 不静默改义。
历史集合名称 routing 保留原 case 身份，不代表生产存在独立路由 Agent。

## 会话输入

新会话用例使用 `agent_eval_cases.v1`，每个 case 有 `case_id`、有序 `turns` 和可选的 `reference`、
`case_family`、`split`。每轮有 `turn_id`、原始 `prompt` 和可选 `expectations`。case 的 expectations
作用于最后实际目标轮，轮次的 expectations 可覆盖它；前置轮失败时不会把目标轮预期套给前置轮。

```json
{
  "schema_version": "agent_eval_cases.v1",
  "cases": [{
    "case_id": "follow-up",
    "reference": "依据同一专业的材料承接第二轮问题。",
    "turns": [
      {"turn_id": "turn-01", "prompt": "请介绍这个专业的毕业要求。"},
      {"turn_id": "turn-02", "prompt": "其中实践学分是多少？"}
    ]
  }]
}
```

`agent_routing_eval_cases.v1` 的 `setup_turns + query` 转换为有序 turns；全部 setup 回答保留，
原有 `reference`、参考证据和禁止项保留为评测预期。历史 `reference_tool_calls` 只用于其明确的目标轮，
不由缺省空数组推断所有会话都禁止工具。

可选确定性预期包含 `tool_sequence`、按工具名的 `max_tool_calls`、`tool_arguments` 和 `max_total_ms`。
`tool_arguments` 的元素为 `{tool_name, arguments}`；缺少实际参数时未评分。没有显式次数或时间上限
时，不创建全局最优路径或性能阈值。机构事实、来源引用与推理质量由语义 rubric 单独判断。

## 保存结果

`agent_eval_sessions.v1` 的 `items` 包含 `{case, session}`；session 保存 `turns`、`expected_turns`
和 `complete`。turn 保留 `turn_id`、执行 request 身份及受控执行投影。
旧 `agent_product_eval_result.v3` 只导入原始答案、上下文和工具轨迹，不导入旧分数，也不补造前置回答。

Inspect 日志是新执行的结果。离线重新评分使用日志中的 sample store；导入文件只是调用方输入，
不再维护另一份结果数据库或 Langfuse dataset。

## 状态与时间

未发生的阶段不适用；发生但缺少正文的阶段语义未评分；工具失败和恢复尝试保留实际身份。
用户 prompt 不改写；离线结果中的请求时间只使用保存的执行事实，不向生产发送模拟时钟。历史相对年份回归可使用
显式保存的 prompt、请求时间和对应答案进行离线评分。

## 相关文档

- [评测](./eval.md)
- [Inspect 操作手册](../runbooks/inspect.md)

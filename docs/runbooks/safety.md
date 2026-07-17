---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 产品安全排查

## 范围

本文说明如何用当前持久化事实排查 abuse throttle 和 safety failure。请求查找在 Ops Web，
不是 Ops Web。

## 信号

- `chat.turn_dispatches`：`safety_identifier`、状态、错误和时间；
- `runtime.request_observability_fact`：ACL、resolved targets、refusal、semantic outcome
  和 trace correlation；
- OpenObserve：辅助日志和调用链，不是 throttle truth。

## 阈值所有权

abuse throttle 与 safety alert 阈值由
`apps/app-api/src/modules/safety-ops-policy.ts` 及其测试拥有。本文不复制数值；变更阈值必须
同时修改 owner code 与测试。

## 处理步骤

1. 在 Ops Web 按时间、状态、requestId、traceId 或 safety 关联摘要定位请求。
2. 确认 turn dispatch 的 terminal 状态和 `error_code`。
3. 使用 observability fact 判断 ACL、resolved targets、remote-content suspicion 或
   provider filter。
4. 需要深入排查时按 request/trace 时间窗口读取 OpenObserve；审计失败时不返回原始记录。
5. 只记录 sanitized request/trace id、pattern code、时间窗口和结论。

## 禁止

- 不从日志 sink 改写 request status 或 throttle truth。
- 不复制 auth、session、memory、prompt、provider response 或 remote raw text 到工单。
- 不恢复 operator request projection 或独立 safety dashboard 数据库。

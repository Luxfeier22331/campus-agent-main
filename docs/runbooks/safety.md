---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 产品安全排查

## 范围

本文说明如何用当前持久化事实排查 abuse throttle 和 safety failure。请求查找在 Ops Web。

## 信号

- `chat.turn_dispatches`：`safety_identifier`、状态、错误和时间；
- `runtime.agent_runs`：运行终态、`terminal_reason`、`fail_close_reason` 和 trace 关联；
- Axiom：脱敏辅助日志和调用链，不是限流状态依据；
- Sentry：经过清理的应用异常，不是用户身份、请求正文或限流状态依据。

`runtime.request_observability_fact` 是 App API 内部投影，Ops Web 当前没有列读取权限，不能作为本
runbook 的排查入口。

## 阈值所有权

abuse throttle 与 safety alert 阈值由
`apps/app-api/src/modules/abuse-throttle-policy.ts` 及其测试拥有。本文不复制数值；变更阈值必须
同时修改所属实现与测试。

## 处理步骤

1. 在 Ops Web 按时间、状态、requestId、traceId 或 safety 关联摘要定位请求。
2. 确认 turn dispatch 的 terminal 状态和 `error_code`。
3. 确认 Agent run 的 `terminal_reason`、`fail_close_reason` 和 trace 关联。
4. 需要深入排查时由 Ops Web 按固定 `requestId` 和有界窗口读取 Axiom；partial response、查询
   失败或审计失败时不返回原始记录。
5. 只记录 sanitized request/trace id、pattern code、时间窗口和结论。

Cloudflare application console logs 绕过 Collector 白名单。若排查中发现 query、header、正文、
用户标识或 credential，应立即停止对应 log destination 或 producer 输出，并按 observability
canary 重新验证；若出现 invocation log/native trace，则先修复必须关闭这两类信号的配置漂移。
调用链应以 W3C context 关联的 Collector runtime trace 为证据，不得把泄漏字段复制进工单。

## 禁止

- 不从日志平台改写请求状态或限流判断。
- 不复制认证、session、记忆、prompt、供应商响应或远端原文到工单。
- 不为安全排查建立第二套请求状态数据库。

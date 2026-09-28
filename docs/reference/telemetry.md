---
doc_type: reference
owner_boundary: runtime-observability
status: active
---

# 运行时遥测

## 边界

本文索引当前仓库自有运行信号、生产者和消费者。精确字段由真实 producer 与合同维护，环境是否接收
数据由实际平台查询证明。产品数据库、Temporal history、Hindsight 数据和普通业务投影不是遥测。

## 信号索引

| 信号 | Producer | Consumer | 用途 | 可执行来源 |
| --- | --- | --- | --- | --- |
| 受控 Agent trace | agent-runtime | Langfuse | 模型/工具调用关联、用量和评测 | Agent sanitizer、Langfuse 运行合同 |

execution-control、ops-web、internal-portal-collection 和 Hindsight 不维护仓库自有 OTel exporter。
它们的数据库投影、Temporal 状态、业务调用和普通进程日志不能改写成外部遥测合同。
App API 的请求状态、阶段耗时和错误码属于 PostgreSQL 产品投影；浏览器、Worker 和 App API 不向
外部错误平台发送专用事件。Worker source map 是 Cloudflare 发布链路的调试输入，不是应用错误事件信号。

## 共同约束

各 producer 的字段白名单和敏感数据边界由实现、测试及所属合同维护；本文不复制字段清单。观测链路
失败不得改写产品、workflow 或个人记忆状态，配置、Collector 或 SDK 存在也不证明环境已经收到数据。

## 浏览器首段计时

`POST /api/chat/requests/:requestId/client-timing` 在现有请求观测记录中首次写入
`client.first_delta_ms`、`client.first_render_ms`。接口复用会话认证、同源限制和请求归属检查。
两个数值都从本次前台提交的 `performance.now()` 起算：前者到收到首个非空答案 delta，后者到
对应答案文本进入 DOM 并经过绘制机会。后台切换和历史加载不产生报告，同页重连保留原起点；
报告只发送一次，不重试、不阻塞答案，也不代表用户已阅读。

客户端观测不属于执行返回合同。产品收尾只消费已知且有效的服务端计时，数据库事务合并保留已存
客户端值；诊断字段不得因执行字段白名单不匹配而阻断成功、失败或取消终态。

## 验证

修改信号时运行所属 producer 测试。外部平台是否收到信号只能通过实际环境查询证明，并且只在任务明确
包含运行验收时成为完成条件。

## 相关文档

- [可观测数据边界](../../.agents/notes/implemented/architecture/2026-07-17-observability-planes.md)
- [退役 Axiom](../../.agents/notes/implemented/simplification/2026-08-22-retire-axiom.md)
- [Langfuse 运行合同](../contracts/langfuse-runtime.md)
- [Worker 发布与平台诊断](../runbooks/worker-otel.md)

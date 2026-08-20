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
| 有界产品请求事件 | App API | Cloudflare log destination、Axiom、Ops Web 固定查询 | 请求接收、终态和传输失败摘要 | App API telemetry 模块及测试 |
| 浏览器与边缘错误、采样性能 | Campus Web、App API | Sentry | 错误定位、release 和前端性能 | 应用 Sentry 初始化与测试 |
| 受控 Agent trace | agent-runtime | Langfuse | 模型/工具调用关联、用量和评测 | Agent sanitizer、Langfuse 运行合同 |

execution-control、ingestion-control、internal-portal-collection 和 Hindsight 不维护仓库自有 OTel exporter。
它们的数据库投影、Temporal 状态、业务调用和普通进程日志不能改写成外部遥测合同。

## 内容边界

运行信号不得包含：

- prompt、回答、聊天全文或用户原始问题；
- memory、检索正文、source body、OCR 原文或工具原始载荷；
- provider 原始响应或任意未裁剪错误正文；
- Cookie、Authorization、JWT、session token、API key、数据库地址或对象存储凭据；
- 通过动态属性名或嵌套 payload 绕过 producer allowlist 的内容。

App API 和 Agent Runtime 的允许字段分别由所属代码及测试维护。文档不复制字段清单；字段变化必须
先修改 producer、合同和测试。

## 消费与故障

- Axiom 只消费获准的 Cloudflare application logs；Ops Web 固定查询只读取
  `attributes.custom` 中允许的摘要字段。
- Sentry 保存获准错误、release/source map 和生产浏览器采样性能，不承担产品终态。
- Langfuse 只消费获准 Agent trace 和显式评测数据；运行 trace 可以因配额停止接收。
- 任一观测链路失败都不能改写 PostgreSQL 产品状态或 Temporal workflow 状态。
- 配置、Collector 或 SDK 存在不证明某环境已经收到数据。

## 验证

修改信号时运行所属 producer 测试；修改 Collector 时运行
`scripts/otel/validate-config.sh`。外部平台是否收到信号只能通过实际环境查询证明，并且只在任务明确
包含运行验收时成为完成条件。

## 相关文档

- `../decisions/adr-0081-observability-planes.md`
- `../contracts/langfuse-runtime.md`
- `../runbooks/otel.md`
- `../runbooks/worker-otel.md`

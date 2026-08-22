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
| 浏览器与边缘错误、采样性能 | Campus Web、App API | Sentry | 错误定位、release 和前端性能 | 应用 Sentry 初始化与测试 |
| 受控 Agent trace | agent-runtime | Langfuse | 模型/工具调用关联、用量和评测 | Agent sanitizer、Langfuse 运行合同 |

execution-control、ingestion-control、internal-portal-collection 和 Hindsight 不维护仓库自有 OTel exporter。
它们的数据库投影、Temporal 状态、业务调用和普通进程日志不能改写成外部遥测合同。
App API 的请求状态、阶段耗时和错误码属于 PostgreSQL 产品投影；它不再为日志供应商生产专用
生命周期事件。

## 共同约束

各 producer 的字段白名单和敏感数据边界由实现、测试及所属合同维护；本文不复制字段清单。观测链路
失败不得改写产品、workflow 或个人记忆状态，配置、Collector 或 SDK 存在也不证明环境已经收到数据。

## 验证

修改信号时运行所属 producer 测试；修改 Collector 时运行
`scripts/otel/validate-config.sh`。外部平台是否收到信号只能通过实际环境查询证明，并且只在任务明确
包含运行验收时成为完成条件。

## 相关文档

- `../decisions/adr-0081-observability-planes.md`
- `../decisions/adr-0092-retire-axiom.md`
- `../contracts/langfuse-runtime.md`
- `../runbooks/otel.md`
- `../runbooks/worker-otel.md`

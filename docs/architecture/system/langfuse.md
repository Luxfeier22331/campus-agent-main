---
doc_type: architecture
owner_boundary: runtime-observability
status: active
---

# Langfuse

## 边界

Langfuse Cloud 是 Agent/LLM 评测平台，保存已准入的 trace、dataset、experiment、score 和
annotation。当前使用 Japan 数据区域中的 `campus-agent` project。它不拥有在线执行、产品数据库、
Temporal history、Hindsight bank、仓库合同或发布决定。

local、staging 和 production 通过 Langfuse 原生 `environment` 字段区分，共用该 project、dataset
和 prompt。是否接收运行 trace 由环境配置和配额策略决定；没有 trace 不代表产品请求没有执行。

## Trace 链路

```text
产品 W3C context
-> execution-control（只传播 context）
-> Agent SDK instrumentation -> OTLP endpoint（可选本地 Collector）
-> Langfuse Cloud `campus-agent` project
```

源码仓的本地 Collector 只有一个 OTLP/HTTP receiver 和一个 Agent trace pipeline。它不采集节点
日志、kubelet metrics、execution-control 或 Hindsight 信号，也不向 Axiom 复制 trace。环境仓可以
选择部署等价的出口，但具体端口、网络和 Secret 不由本文件证明。

Agent SDK instrumentation 唯一产生 model generation 与 tool observation。execution-control 只保留
产品投影、Temporal durable execution 和 W3C context propagation，不创建或导出编排 OTel span。

Langfuse 不可用不得阻塞普通在线回答。执行生命周期由 Temporal 保存，产品状态由 PostgreSQL
投影保存。

## 身份与数据

产品 trace identity 在内部运行时传播。Agent trace 可以按合同保存 user/session 关联以及
`request_id`、`run_id`、`trace_id`、`turn_id` metadata。Hindsight 不产生 Langfuse trace。

Langfuse Cloud project 是受信任模型观测面。采样 trace 可以包含 user/session 关联、模型/工具
标识、usage、阶段结果和有界关联 metadata。Agent producer 关闭 SDK sensitive data 导出；运行
trace 不包含模型输入输出、对话、memory/retrieval 正文、工具原始载荷、供应商原始响应或认证
材料。Collector 的属性清理是纵深防御，不代替 producer 的源头限制。

dataset、experiment、score 和 annotation 保持独立评测生命周期。需要正文的 case 必须经版本化
输入和显式评审导入，不能从运行 trace 正文自动生成。

## 生命周期

运行 trace 的保留期由 Langfuse project 策略拥有，不由 Temporal workflow 维护。个人记忆清除只处理
产品投影和 Hindsight bank；Langfuse 可选 trace 不参与命令 lifecycle 或 `erased` 终态。

## 相关资料

- `../../contracts/langfuse-runtime.md`
- `../../reference/eval.md`
- `../../runbooks/otel.md`
- `../../runbooks/hindsight.md`
- Langfuse environments：<https://langfuse.com/docs/observability/features/environments>
- Langfuse OpenTelemetry：<https://langfuse.com/integrations/native/opentelemetry>
- Langfuse data retention：<https://langfuse.com/docs/administration/data-retention>

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
`request_id`、`run_id`、`trace_id`、`turn_id` metadata。Hindsight 不再产生新的 Langfuse trace；
删除流程仍会清理历史遗留的 Hindsight bank trace identity。

Langfuse Cloud project 是受信任模型观测面。采样 trace 可以包含 user/session 关联、模型/工具
标识、usage、阶段结果和有界关联 metadata。Agent producer 关闭 SDK sensitive data 导出；运行
trace 不包含模型输入输出、对话、memory/retrieval 正文、工具原始载荷、供应商原始响应或认证
材料。Collector 的属性清理是纵深防御，不代替 producer 的源头限制。

dataset、experiment、score 和 annotation 保持独立评测生命周期。需要正文的 case 必须经版本化
输入和显式评审导入，不能从运行 trace 正文自动生成。

## 生命周期

个人记忆删除先停止旧 bank 接收新请求并等待旧 lease 排空，再删除 Hindsight bank。随后 Temporal
workflow 使用 command 冻结的产品用户和 `source_updated_at` 上界删除 Agent/runtime trace，并使用
上一代 bank identity 清理历史 Hindsight trace。等待既有 exporter 的有界排空窗口后，删除和复核按
有界轮次执行；两类查询都为零后才能完成产品删除状态。

execution-control core worker 只使用 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY` 和
`LANGFUSE_SECRET_KEY` 执行 owner erase。普通 trace
保留期由 Langfuse 部署策略拥有，不再由自研 Temporal retention workflow 维护。精确分页、批量、
等待、重试和失败语义由运行合同维护。

## 相关资料

- `../../contracts/langfuse-runtime.md`
- `../../reference/eval.md`
- `../../runbooks/otel.md`
- `../../runbooks/hindsight.md`
- Langfuse environments：<https://langfuse.com/docs/observability/features/environments>
- Langfuse OpenTelemetry：<https://langfuse.com/integrations/native/opentelemetry>
- Langfuse data deletion：<https://langfuse.com/docs/data-deletion>
- Langfuse data retention：<https://langfuse.com/docs/administration/data-retention>

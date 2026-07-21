---
doc_type: architecture
owner_boundary: runtime-observability
status: active
---

# Langfuse

## 边界

Langfuse Cloud 是 LLM、Agent 与记忆可观测和评测平台，保存 trace、dataset、experiment、
score 和 annotation。当前使用 Japan 数据区域中的 `campus-agent` project。它不拥有在线执行、
产品数据库、Temporal history、Hindsight bank、仓库合同或发布决定。

local、staging 和 production 通过 Langfuse 原生 `environment` 字段区分，共用该 project、
dataset 和 prompt。Agent、execution-control 与 Hindsight 通过独立 Collector receiver、
`service.name` 和固定 tag 区分来源，不通过多个 project 复制凭据和维护流程。

## Trace 链路

```text
产品 W3C context
-> execution-control 编排 -> Collector :4319
-> Agent SDK instrumentation -> Collector :4320
-> Langfuse Cloud `campus-agent` project

execution-control Activity context
-> memory.call -> Collector :4319
-> Hindsight 原生 OpenTelemetry -> Collector :4321
-> Langfuse Cloud `campus-agent` project
```

Collector 的分入口用于限制生产者、处理器和输出目标，不用于划分 Langfuse project。入口通过
NetworkPolicy 隔离，不在集群内重复增加 bearer token。通用运行信号进入 Axiom；Agent、
Hindsight 和受控 execution-control trace 进入 Langfuse。

Agent SDK instrumentation 唯一产生 model generation 与 tool observation。execution-control 只
记录编排和跨系统关联，不重复声明 generation、model 或 token usage。

Langfuse 不可用不得阻塞普通在线回答。执行生命周期由 Temporal 保存，产品状态由 PostgreSQL
投影保存。

## 身份与数据

产品 trace identity 确定性映射到 W3C trace context，并在内部运行时传播。运行 trace 使用产品
用户身份；Hindsight trace 使用 execution-control 派生的 bank identity。两类 identity 位于同一
project，但含义和删除条件不同。

Langfuse Cloud project 是受信任模型观测面。采样 trace 可以包含 user/session 关联、模型输入输出、
memory context、已授权 retrieval facts、tool observation 和 usage。producer 不得主动写入结构化
认证材料、数据库凭据、对象存储 secret 或 provider credential；Collector 按认证类 attribute key
清理，但不会扫描 trusted model I/O 的每个字面值，因此当前没有内容级 DLP 承诺。

## 生命周期

个人记忆删除先停止旧 bank 接收新请求并等待旧 lease 排空，再删除 Hindsight bank。随后 Temporal
workflow 使用 command 冻结的产品用户和 `source_updated_at` 上界删除 runtime trace，并使用上一代
bank identity 删除全部 Hindsight trace。等待 Collector 最大重试窗口后，删除和复核按有界轮次
执行；两类查询都为零后才能完成产品删除状态。

execution-control core worker 只使用 `LANGFUSE_MAINTENANCE_*` 凭据执行 owner erase。普通 trace
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

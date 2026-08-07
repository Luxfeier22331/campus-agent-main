---
doc_type: runbook
owner_boundary: runtime-observability
status: active
---

# OpenTelemetry Collector

## 范围

本文说明如何校验本地单进程 Collector，并排查 staging 的 Agent DaemonSet 与 Gateway Deployment。
当前本地配置、receiver、端口和 pipeline 见 `../../infra/otel/README.md`；事件、指标和字段见
`../reference/telemetry.md`。环境 endpoint、dataset、Secret、节点准备、保留期和启用状态由环境
仓管理。

这里的 Collector 不是 `apps/source-collector`。Cloudflare Worker application-log destination 不经过
本 Collector，按 `worker-otel.md` 验证。

## 配置校验

运行仓库检查：

```bash
pnpm ci:otel
```

该命令先检查受信任链路清理规则，再使用固定 digest 的 `otelcol-contrib` 镜像校验本地 debug 和
prodlike 配置。环境仓负责分别对 Agent 与 Gateway Helm values 执行 render、schema 与策略检查。
源码检查不证明目标环境已部署或外部平台已收到数据。

手工校验必须使用 contrib distribution，不能使用缺少处理器和 exporter 的 core distribution。
真实 endpoint、dataset 和凭据只能来自本地未跟踪环境或 Secret manager，不得写回仓库。

## 本地调试

启动 debug Collector：

```bash
otelcol-contrib --config=infra/otel/collector-local-debug.yaml
```

execution-control 的 trace/metric endpoint 指向 `127.0.0.1:4318` 对应的 OTLP/HTTP 路径。本地
debug 与集群 receiver 都不使用 bearer token；集群内生产者由固定端口和 NetworkPolicy 隔离。

本地检查至少确认：

- 只有预期生产者能够访问对应 receiver；
- execution-control 产生受控编排 span 和低基数 metric；`grounding.prepare` span 包含
  `grounding_mode`、`grounding_status`、证据/token/context 计数；本次检索提供诊断时还包含候选
  数和四个阶段耗时，重放已有 context 不以零值补齐缺失诊断；
- Agent Runtime 的 model generation/token usage 与 `grounding.prepare` span 位于同一产品 trace，
  但不由 execution-control 重复发送；
- `memory.call` 不包含 URL、document、正文或原始 bank identity；
- metric label 不包含请求、用户、会话、run、trace、bank 或文档 ID；
- 通用清理副本不包含 prompt、回答、检索正文、memory、认证材料或 secret。

## 真实信号验证

发起不包含真实认证材料的受控请求，记录产品 `requestId`、`runId` 和 `traceId`：

1. 在 Agent 日志确认 filelog 与 kubeletstats pipeline 正常，在 Gateway 自身指标确认各 receiver
   接收量、内存队列和 exporter failure。
2. 在 Axiom 分别查询 Collector 写入的 log、trace 和 metric，确认字段符合白名单，并通过
   `campus.request_id`、`campus.trace_id` 关联请求级 runtime trace。
3. 在单一 Langfuse project 查询 Agent、model generation、tool observation 与受控编排 span，
   确认 `grounding.prepare` 是 `span`，grounding 摘要可见，且编排 span 没有被标记为 generation。
4. 执行一次 Hindsight retain/recall，确认 `memory.call` 与下游 span 关联，派生 bank identity 只
   存在于 Langfuse 受信任链路。
5. 使用合成哨兵覆盖 query、header、正文、用户标识和 credential 位置：
   - Axiom 和其他通用信号中，正文与认证字段必须零匹配；
   - Langfuse 运行 trace 中，模型输入输出、对话、memory/retrieval 正文、工具原始载荷、结构化
     header、Cookie、token、数据库地址和其他认证内容都必须零匹配。

合成哨兵只验证代表性路径，不构成内容级 DLP 承诺；producer 的
`traceIncludeSensitiveData=false` 和字段白名单才是主要边界。正文规则以
`docs/contracts/langfuse-runtime.md` 为准。

需要核对 runtime Langfuse trace 时使用：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts verify-trace \
  --product-trace-id <product-trace-id> \
  --request-id <request-id> \
  --run-id <run-id> \
  --workflow-id <workflow-id> \
  --session-id <conversation-id> \
  --user-id <stable-user-id> \
  --release <runtime-release> \
  --json
```

运行结果属于本次发布或故障记录，不提交到仓库。

## 故障排查

Collector 链路收到信号但下游没有记录时，依次检查：

1. 信号来自 Agent 采集路径还是直接进入 Gateway，并核对对应 NetworkPolicy；
2. Agent 的采集与发送日志、Gateway receiver、内存发送队列、retry 与 exporter failure；
3. `telemetry.drop`、入口过滤器、字段 transform 和采样比例；
4. Axiom endpoint、三个 dataset 和环境共享 runtime token 的 Ingest 权限，或 Langfuse endpoint 与
   Basic auth；
5. 受信任 trace 是否被错误发送到通用入口，或输出路由是否交叉；
6. Agent 是否因 kubelet CA/SAN、checkpoint 目录权限或 filelog 路径失败；
7. 环境仓是否实际选择了预期配置和不可变版本。

Cloudflare application-log destination 问题按 `worker-otel.md` 排查，不能从 Collector 指标推断。
任何观测输出失败都不得改写 PostgreSQL 产品状态。

## 参考

- OpenTelemetry Collector 配置：<https://opentelemetry.io/docs/collector/configuration/>
- Axiom OpenTelemetry ingest：<https://axiom.co/docs/send-data/opentelemetry>
- Langfuse OpenTelemetry：<https://langfuse.com/integrations/native/opentelemetry>

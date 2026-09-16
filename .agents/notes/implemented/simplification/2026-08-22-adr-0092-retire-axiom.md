# Agent Note: ADR-0092 退役 Axiom

Status: implemented

## 背景

App API 曾为 Cloudflare Worker application-log destination 生产 Axiom 专用 envelope 中的
`request.accepted`、`request.finalized` 和 `request.transport_error` 三类事件，Ops Web 再按
`requestId` 查询 Axiom。这里的 `request.accepted` 不指浏览器仍使用的 SSE 产品事件；实际产品状态、
工作流状态、应用错误和 Agent trace 分别由 PostgreSQL、Temporal、Sentry 和 Langfuse 拥有；没有运行
决策、告警或产品行为消费这组三类日志。Sentry 相关描述属于当时的迁移背景；当前仓库已不再包含 Sentry runtime consumer，现行遥测边界以 `docs/reference/telemetry.md` 为准。

保留这条链路仍要求维护 producer、字段合同、Cloudflare destination、dataset、查询 token、Ops Web
client/API/UI、Terraform root 和发布验收，却不能回答上述事实所有者之外的新问题。为假设性的未来需求
继续采集会产生供应商成本、敏感数据面和配置漂移风险。

## 决策

- App API 不再生产供应商专用请求生命周期事件；请求状态、错误码和阶段耗时继续写入所属
  PostgreSQL 投影。
- status-web 不再输出仅用于外部日志采集的成功周期或失败摘要；调度异常仍向调用方抛出。
- Ops Web 删除日志查询 client、HTTP 接口、DTO、页面入口、外部链接、凭据和配置，只保留
  PostgreSQL 运行记录以及 Temporal、Langfuse 跳转。
- Cloudflare Worker application-log destination 在 Source 消费者删除后断流；确认没有其他 Worker
  使用同一 destination 后删除 destination。Cloudflare invocation logs、本地持久化和 native traces
  继续关闭，不能充当替代链路。
- Axiom dataset 在 destination 删除和零生产者证据取得后，通过独立 Terraform saved plan 只执行目标
  dataset 的删除。随后再删除 Terraform root、临时策略、工作流合同和最后一枚平台 token。
- 退役期间不增加兼容开关、空实现、第二日志存储或供应商 fallback。Source、GitOps desired state、
  deployed state 和供应商数据事实分别验证，不能互相替代。

## 未采用方案

- **保留 Axiom 链路以备将来查询**：可以继续提供通用日志搜索，但没有现行决策消费者，仍持续承担
  供应商成本、凭据和部署维护。
- **增加第二日志存储或兼容开关**：保留了切换路径，也保留了本次要移除的重复数据面；
  未来有明确需求时按重新引入条件重新选择方案。

## 后果

- 在线请求与产品状态不受影响，运行记录仍由持久投影提供；
- 错误诊断继续使用应用自身日志，Agent/LLM trace 继续按环境策略使用 Langfuse，完整工作流历史继续由
  Temporal 保存；
- 删除没有决策消费者的日志可降低供应商成本、凭据面和维护负担；
- 失去通用 application-log 搜索是有意接受的结果；若未来出现真实需求，按上述条件重新设计。

## 重新引入条件

未来只有在出现明确的运行需求时才重新评估日志平台。提案必须同时说明：

1. 哪个具体用户或自动化消费者将使用该信号，以及它驱动的查询、告警或决策；
2. 现有 PostgreSQL、Temporal、Langfuse 和应用日志为什么不能回答该问题；
3. producer 字段白名单、敏感数据边界、基数、采样、保留期和成本预算；
4. owner、运行验收、故障语义和无消费者后的退出条件。

满足这些条件也不预先指定 Axiom；供应商选择应基于当时的需求重新评估。历史 dataset、token、代码
或配置不作为恢复入口。

## 相关文档

- [运行时遥测](../../../../docs/reference/telemetry.md)
- [产品运行时](../../../../docs/architecture/system/product-runtime.md)
- [运行记录接口](../../../../docs/contracts/ops-web/runtime.md)
- [Worker 发布与平台诊断](../../../../docs/runbooks/worker-otel.md)
- [ADR-0081 可观测数据边界](../architecture/2026-07-17-adr-0081-observability-planes.md)
- 部分取代 [ADR-0081 可观测数据边界](../architecture/2026-07-17-adr-0081-observability-planes.md)

---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Scheduled recovery sweep 合同

app-api 的 `scheduled()` 是持久化恢复入口，不承担新的业务编排职责。当前入口按固定顺序串行执行
account-admin、email-access、chat admission、runtime cancellation、profile-memory 和
account-lifecycle sweep。

每个 sweep 都有独立错误边界：单个 sweep 失败时记录带有稳定 `task` 名称的结构化错误，并继续执行
后续 sweep；一次 invocation 不因单个 sweep 失败而抛出。业务重试由各自的 PostgreSQL outbox、claim
和 lease 提供，不依赖 Cloudflare 对整次 invocation 的重试。

runtime cancellation 的 HTTP cancel 与 scheduled dispatcher 共享同一 PostgreSQL lease claim。只有
成功取得 claim 的调用方可以执行远端取消或本地 finalization；取消接口的 `202` 仍只表示取消意图已
持久化接收，不表示远端已经完成。dispatcher 逐条取得独立 lease，完成或失败写回以 lease token
作为 fencing 条件；单纯超过 lease 时间不会否定尚未被新 claim 替换的 owner。

Cloudflare cron trigger 属于环境仓的 Cloudflare Terraform desired state。源码仓的 Wrangler 配置只
提供 `scheduled()` 实现，不声明部署环境的 cron；环境仓负责选择周期、Worker version、reconcile 和
部署后的 trigger 验证。当前 staging 的 app-api trigger 由环境仓 `cloudflare/staging/workers` root
声明；具体周期只以环境仓 desired state 为准，本合同不在源码仓重复声明或改写该周期。

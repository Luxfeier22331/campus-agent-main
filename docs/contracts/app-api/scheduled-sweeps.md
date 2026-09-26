---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Scheduled recovery sweep 合同

App API 的 `scheduled()` 是持久化恢复入口，仅派发所属模块任务。实现位于
`apps/app-api/src/index.ts`，当前任务及配置条件如下：

| 稳定任务名 | 配置条件与处理入口 |
| --- | --- |
| `account-admin` | 部署环境；将超时的账号管理命令标记为结果不明 |
| `email-access` | 部署环境或显式注入服务；处理到期邮箱授权 |
| `dining` | 独立执行；处理到期内容、未引用媒体和已受理的账号注销 |
| `memory` | execution-control runtime 已配置；派发个人记忆任务并自动重试失败的生命周期命令 |
| `account-lifecycle` | execution-control runtime 已配置；续接账号注销任务 |

各任务的服务初始化和执行位于独立 Promise 边界，使用 `Promise.allSettled` 等待全部结果。
单项失败不阻断其他任务；失败记录包含稳定 `job` 名和 `scheduled_job_failed` 错误码，等待全部
任务后通过 `AggregateError` 报告本次调用失败。表格顺序不表示跨模块完成先后或依赖关系。
业务重试、lease 与完成条件仍由所属模块维护。

Cloudflare cron trigger 属于环境仓的 Cloudflare Terraform desired state。源码仓的 Wrangler 配置只
提供 `scheduled()` 实现，不声明部署环境的 cron；环境仓负责选择周期、Worker version、reconcile 和
部署后的 trigger 验证。具体环境的 Terraform root 和周期以环境仓 desired state 为准。

## Dining 清理

Dining 入口与账号任务共用 `modules/dining/lifecycle.ts`。领域期限、引用规则和清理元数据由
[Dining PRD](../../product/dining.md) 维护；调度器不复制状态或 TTL，不新建 cleanup Job。

清理先复核并清除到期正文和身份，再按投稿、照片顺序锁定引用、登记清理尝试。对象版本删除在事务外
执行，成功后删除照片记录；失败保留同一项，过期的执行中项可续接。每批最多处理八张照片，避免占满
账号任务的五分钟 lease。全部照片完成后才写投稿清理时间；他人评价从该时间再保留 30 天。

历史文字及举报详情按各自事件期限清理，举报到期不自动结案。无必要引用的投稿占位随所属清理删除。
账号请求 ID 保留至清理完成，避免清空作者后丢失对象责任。真实对象版本删除、云端触发与权限验收
属于环境 owner，本地故障适配器测试不能替代这些验收。

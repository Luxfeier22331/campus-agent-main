---
doc_type: contract
owner_boundary: apps/ops-web
status: active
---

# 通知管线 Job 接口

Ops Web 为维护者提供固定通知 Job 操作入口。它复用部署中现有的暂停 CronJob 模板，不提供任意
Kubernetes 资源、命令、镜像、环境变量或 namespace 控制。

## HTTP 接口

- `POST /api/ops/notice-pipeline/jobs`：启动一个固定操作；
- `GET /api/ops/notice-pipeline/jobs`：读取最近的 Ops Web 通知 Job；
- `GET /api/ops/notice-pipeline/jobs/:jobName`：读取一条 Ops Web 通知 Job。

POST 正文只接受以下互斥形状：

```json
{ "operation": "notice-sync" }
{ "operation": "notice-backfill", "startDate": "2026-08-01" }
{ "operation": "notice-classify-missing" }
{ "operation": "notice-classify-one", "noticeId": 354516 }
{ "operation": "notice-publish-all" }
{ "operation": "notice-publish-one", "noticeId": 354516 }
```

采集、分类和发布各自构成一个操作族。同一操作族已有 `pending` 或 `running` Job 时，新请求返回
`409 OPS_NOTICE_JOB_CONFLICT`；系统不排队、不自动串联、不自动重试。Kubernetes API 或模板不可用时
返回 `503 OPS_NOTICE_JOB_UNAVAILABLE`。

## 模板映射

| 操作 | CronJob 模板 | 本次 Job 变化 |
| --- | --- | --- |
| `notice-sync` | `notice-sync` | 无 |
| `notice-backfill` | `notice-backfill` | 注入 `INTERNAL_PORTAL_NOTICE_START_DATE` |
| `notice-classify-missing` | `notice-classifier` | 无 |
| `notice-classify-one` | `notice-classifier` | 参数改为 `--notice-id <id>` |
| `notice-publish-all` | `notice-publisher` | 保留 `publish` |
| `notice-publish-one` | `notice-publisher` | 参数改为 `publish --notice-id <id>` |

镜像、ServiceAccount、Secret 引用、资源限制和其余环境变量全部来自 CronJob `spec.jobTemplate`。
GitOps desired state 只包含这些暂停的 CronJob 模板。Ops Web 创建的 Job 不是独立 desired state；它以
来源 CronJob 的 `ownerReference` 作为运行子资源，避免进入 Argo CD 顶层 orphan 检查。每个动态 Job
固定 `backoffLimit: 0`，失败后不重试；完成后由 `ttlSecondsAfterFinished: 86400` 保留 24 小时再
回收 Job 和 Pod。

## 状态和摘要

响应中的 Job 状态为 `pending`、`running`、`succeeded` 或 `failed`。成功 Job 的最后一条结构化 stdout
记录可以包含 `{ "summary": { ... } }`；Ops Web 只返回其中有限的字符串、布尔值和非负整数。原始日志、
Secret、堆栈和任意 Pod 输出不进入浏览器响应。没有结构化摘要时 `summary` 为 `null`，不推测处理数量。

页面将 `pending`、`running` 显示为活动任务，将 `succeeded`、`failed` 显示为历史结果。只有活动
任务参与同操作族互斥和页面轮询；失败历史不阻塞新任务，也不代表 Argo CD 或服务健康异常。Job 入口失败时
只输出 DNS 解析失败、连接拒绝、网络超时或通用失败的固定分类，不输出原始错误、token、header 或堆栈。

24 小时后的任务历史当前不持久化。Kubernetes Job 只提供短期排障证据，不承担长期审计；出现明确的长期
审计需求后，再由 Ops Web 自有存储保存所需的最小结果。

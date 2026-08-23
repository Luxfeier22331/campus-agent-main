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

## 状态和摘要

响应中的 Job 状态为 `pending`、`running`、`succeeded` 或 `failed`。成功 Job 的最后一条结构化 stdout
记录可以包含 `{ "summary": { ... } }`；Ops Web 只返回其中有限的字符串、布尔值和非负整数。原始日志、
Secret、堆栈和任意 Pod 输出不进入浏览器响应。没有结构化摘要时 `summary` 为 `null`，不推测处理数量。

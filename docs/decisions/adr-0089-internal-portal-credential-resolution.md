---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0089
status: accepted
supersedes: ADR-0077
partially_supersedes: ADR-0024
partially_superseded_by: ADR-0091
---

# ADR-0089 简化采集控制面与内部门户凭据所有权

## 背景

通知和文件发布采集已经具备独立 CLI，当前阶段不需要通用任务注册表、PostgreSQL 任务投影或长期
Temporal workflow。TGC 凭据池、真实检查和候选解析属于受保护的 Ops Web 运维边界，采集进程只在
执行时请求一个可用凭据。

## 决策

- 退役 ingestion 侧 Temporal workflow、worker、任务 API、任务表、任务注册表和文件发布 workflow；
  execution-control 的 Temporal 运行时不受影响；
- 保留独立 Rust kernels、canonical/retrieval 合同和对象存储辅助能力，但不再通过 ingestion-control
  注册或调度；
- Ops Web 直接拥有 TGC、检查结果、CAS 更新值、候选解析和 `internal_portal.automation_tokens`；复用
  `ops_web` 数据库角色和既有 `OPS_WEB_INTERNAL_TOKEN`，不新增数据库、角色、TGC Secret 或服务 token；
- `jobs/internal-portal-collection` 提供通知与文件发布共用的本地 CLI 和一次性 Job 入口。Job 入口调用
  Ops Web 内部接口解析可用 TGC；本地 `internal-portal:auth:pull` 临时 port-forward Ops Web 后把结果写入
  受管理的 `.env.local`；
- 文件发布只做原始文件和 `source.json` 采集，不做 PDF 解析、OCR、清洗、分类或定时调度；
- 历史 ingestion-control 凭据表已迁回 Ops Web 所有权，退役 migration 删除不再使用的 Temporal 任务表。
  数据库集成测试覆盖字段相等、automation token 保留和最终角色权限。

## 结果

当前采集链路只有显式 CLI/Job 进程，没有第二套持久任务状态。Ops Web 负责凭据健康和候选解析，线上
Job 与本地 CLI 继续共用采集实现。Ops Web 可以从固定暂停 CronJob 模板创建一次性通知 Job，但不得
恢复通用任务注册表、工作流控制面或任意 Kubernetes 操作入口。

ADR-0091 进一步退役了本 ADR 当时保留但没有消费者的 Rust 分块栈和 canonical/retrieval 合同；对象
存储辅助能力与本文的采集控制面结论不受影响。

## 相关文档

- `../architecture/system/data-plane.md`
- `../data/internal-portal.md`
- `../runbooks/portal-auth.md`
- `../runbooks/ingestion.md`

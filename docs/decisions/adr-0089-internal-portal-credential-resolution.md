---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0089
status: accepted
supersedes: ADR-0077
partially_supersedes: ADR-0024
---

# ADR-0089 简化采集控制面与内部门户凭据所有权

## 背景

通知和文件发布采集已经具备独立 CLI，当前阶段不需要通用任务注册表、PostgreSQL 任务投影或长期
Temporal workflow。另一方面，TGC 曾由 Ops Web 同时承担页面、数据库、真实检查和采集解析，导致
前端/BFF 持有采集控制面的状态。

## 决策

- 退役 ingestion 侧 Temporal workflow、worker、任务 API、任务表、任务注册表和文件发布 workflow；
  execution-control 的 Temporal 运行时不受影响；
- 保留独立 Rust kernels、canonical/retrieval 合同和对象存储辅助能力，但不再通过 ingestion-control
  注册或调度；
- ingestion-control 成为 TGC、检查结果、CAS 刷新值和候选解析的唯一运行所有者；复用既有
  `ingestion_control` 数据库角色和 `OPS_WEB_INTERNAL_TOKEN`，不新增数据库、角色、TGC Secret 或服务
  token；
- Ops Web 保留人员页面、automation endpoint 和 `internal_portal.automation_tokens`，所有凭据操作通过
  内部 HTTP 转发 ingestion-control，不直接读取 TGC 表；
- `jobs/internal-portal-collection` 提供通知与文件发布共用的本地 CLI 和一次性 Job 入口。Job 入口调用
  ingestion-control 解析可用 TGC；本地 `internal-portal:auth:pull` 临时 port-forward
  ingestion-control 后把结果写入受管理的 `.env.local`；
- 文件发布只做原始文件和 `source.json` 采集，不做 PDF 解析、OCR、清洗、分类或定时调度；
- Ops Web migration 先无损迁移旧凭据行并删除旧表，ingestion-control migration 再删除 Temporal
  任务表。首次交接时两个 base 必须由同一个 Application 按 sync wave 发布，不能依赖 child
  Application 之间的顺序。数据库集成测试覆盖字段相等、automation token 保留和最终角色权限。

## 结果

当前采集链路只有显式 CLI/Job 进程，没有第二套持久任务状态。Ops Web 回到 UI/BFF 边界，凭据健康和
采集解析归 ingestion-control。线上 Job 与本地 CLI 必须继续共用采集实现；不得恢复通用任务控制面作为
默认前提。

## 相关文档

- `../architecture/system/data-plane.md`
- `../data/internal-portal.md`
- `../runbooks/portal-auth.md`
- `../runbooks/ingestion.md`

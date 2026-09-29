# Agent Note: 简化采集控制面与内部门户凭据所有权

Status: implemented

## 背景

通知和文件发布采集已经具备独立 CLI，当前阶段不需要通用任务注册表、PostgreSQL 任务投影或长期
Temporal workflow。TGC 凭据池、真实检查和候选解析属于受保护的 Ops Web 运维边界，采集进程只在
执行时请求一个可用凭据。

旧 ADR-0077 为确定性文件任务选择 Temporal，目的是统一持久重试、超时、心跳、取消、版本路由和
状态查询，避免来源 HTTP 接口、数据库租约与回调分别拥有一段生命周期。注册表曾冻结 Rust kernel
执行信息，调用方传入带摘要的对象引用；Activity 只返回结果引用和有界摘要，详细产物进入对象存储，
PostgreSQL 仅保存查询投影，取消须传播到外部请求和产物写入。该限制防止抓取细节无限扩大 workflow history。

## 决策

- 退役 ingestion 侧 Temporal workflow、worker、任务 API、任务表、任务注册表和文件发布 workflow；
  execution-control 的 Temporal 运行时不受影响；
- 当时保留独立 Rust kernels、canonical/retrieval 合同和对象存储辅助能力，但不再通过
  ingestion-control 注册或调度；该条的 Rust 分块栈及合同保留决定已被
  [退役旧文档分块栈](./2026-08-21-retire-document-chunking-stack.md)取代，不是当前保留要求；
- Ops Web 直接拥有 TGC、检查结果、CAS 更新值、候选解析和 `internal_portal.automation_tokens`；复用
  `ops_web` 数据库角色和既有 `OPS_WEB_INTERNAL_TOKEN`，不新增数据库、角色、TGC Secret 或服务 token；
- `jobs/internal-portal-collection` 提供通知与文件发布共用的本地 CLI 和一次性 Job 入口。Job 入口调用
  Ops Web 内部接口解析可用 TGC；本地 `internal-portal:auth:pull` 临时 port-forward Ops Web 后把结果写入
  受管理的 `.env.local`；
- 文件发布只做原始文件和 `source.json` 采集，不做 PDF 解析、OCR、清洗、分类或定时调度；
- 历史 ingestion-control 凭据表已迁回 Ops Web 所有权，退役 migration 删除不再使用的 Temporal 任务表。
  数据库集成测试覆盖字段相等、automation token 保留和最终角色权限。

采集完成不等于发布：来源采集不自动生成 reader、切换索引或成为在线证据，也不由在线请求现场
采集。当前发布输入与激活职责见[采集数据面](../../../../docs/architecture/system/data-plane.md#离线索引边界)。
详细进度不重新写入通用 workflow 或任务投影；Ops Web 的固定 Job 操作不扩大为任意任务控制面。

## 未采用方案

### 继续保留采集 Temporal 编排

旧方案已经把按 ID 的文件发布采集与通用任务模型分开：不创建父子 pipeline、物化阶段或额外任务
投影；本地通知同步和定期认证检查也不进入 Temporal。当前明确的 CLI/Job 需求不足以继续支撑剩余
通用注册表与持久编排，退役后有意放弃该采集链的 workflow 级恢复、版本路由和状态查询，而非换成
另一套数据库任务状态。来源适配器的依赖与凭据仍由所属模块维护。

## 后果

当前采集链路只有显式 CLI/Job 进程，没有第二套持久任务状态。Ops Web 负责凭据健康和候选解析，线上
Job 与本地 CLI 继续共用采集实现。Ops Web 可以从固定暂停 CronJob 模板创建一次性通知 Job，但不得
恢复通用任务注册表、工作流控制面或任意 Kubernetes 操作入口。

[退役旧文档分块栈](./2026-08-21-retire-document-chunking-stack.md)退役了当时保留但没有消费者的
Rust 分块栈和 canonical/retrieval 合同。对象存储辅助能力仍由实际 producer 在所属模块内维护，
不保留独立通用 package；本篇的采集控制面、凭据所有权和 CLI／Job 入口结论继续有效。

### 重新评估与验证边界

若出现确需跨进程恢复、持久取消或版本路由的采集消费者，应重新比较 CLI/Job 与持久编排，不能将
本次退役解释为禁止其他 owner 使用 Temporal。旧 ADR 没有独立记录测试执行结果，历史心跳和取消
规则不是当前采集仍受 workflow 保障的证据；本篇已有的凭据迁移验证范围也不证明环境已部署。

## 相关文档

- [采集数据面](../../../../docs/architecture/system/data-plane.md)
- [内部门户数据](../../../../docs/data/internal-portal.md)
- [内部门户认证](../../../../docs/runbooks/access/portal-auth.md)
- [采集运行](../../../../docs/runbooks/ingestion/ingestion.md)

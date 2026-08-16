---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0077
status: accepted
---
# ADR-0077 Temporal 采集编排

## 背景

确定性离线文件任务需要持久重试、超时、取消、版本路由和可查询状态。内部门户文件发布也需要
持久执行，但它只是按精确 ID 保存来源文件，不需要套入通用任务、物化和发布模型。

## 决策

- 每个注册任务由 `apps/ingestion-control` 启动一个 Temporal workflow；
- 调用方提交带摘要的对象引用，ingestion-control 在启动前从任务注册表冻结执行信息；
- 任务注册表只声明 Rust kernel，ingestion-control 调用 `packages/ingestion-kernels-rs`；
- activity 只向 Temporal 返回结果引用和有界摘要，详细产物进入对象存储；
- Temporal 维护执行状态、重试、超时、心跳、取消和任务分发；
- PostgreSQL 只保存产品和运维查询需要的有界任务投影；
- 内部门户文件发布使用独立的每 ID workflow，直接调用 source-collector Activity，只在 source
  bucket 保存原文件和 `source.json`；
- 文件发布不进入任务注册表或 PostgreSQL 投影，不创建父子 pipeline、物化阶段或离线发布流；
- 长 Activity 使用心跳报告有界进度，取消必须传播到外部请求和产物写入；
- 来源采集与 Campus Docs 索引发布分离，采集成功不会自动生成 reader 或切换当前索引。

source-collector 的本地通知同步命令不进入 Temporal；定期认证检查也由 Kubernetes CronJob 直接
执行。

任务字段、版本、执行器和对象路径由 schema、注册表及实现维护，不由 ADR 固定。

## 结果

- 执行生命周期只有 Temporal 一个持久编排系统；
- 页面、附件和详细观测不会扩大 workflow history 或 PostgreSQL 投影；
- 来源适配器和文件内核保持独立依赖与凭据边界；
- 简单来源采集不需要为通用任务模型生成额外状态和持久化对象；
- 注册任务产物不会自动进入在线检索；当前 Campus Docs publisher 只消费文档站已清洗的当前
  reader，并通过完整新索引和当前指针独立激活。

## 未采用方案

- 由来源专用 HTTP 接口、数据库租约或回调共同维护任务生命周期；
- 把详细抓取进度逐项写入 workflow signal 或 PostgreSQL；
- 让在线请求现场采集，或把采集成功直接视为知识目标已发布。

## 参考

- [Temporal Activities](https://docs.temporal.io/activities)
- [Temporal Activity heartbeats](https://docs.temporal.io/encyclopedia/detecting-activity-failures#activity-heartbeat)
- [Temporal cancellation](https://docs.temporal.io/develop/typescript/cancellation)
- `docs/architecture/system/data-plane.md`
- `docs/runbooks/ingestion.md`

---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0077
status: accepted
---
# ADR-0077 Temporal 采集编排

## 背景

离线来源任务需要持久重试、超时、取消、版本路由和可查询状态，同时要避免把页面、附件和文件
处理结果写入工作流历史。来源采集与确定性文件处理还需要独立依赖和凭据边界。

## 决策

- 每个采集任务由 `apps/ingestion-control` 启动一个 Temporal workflow；
- 调用方提交带摘要的对象引用，ingestion-control 在启动前从任务注册表冻结执行信息；
- 来源 activity 在 `apps/source-collector` 执行，确定性文件 activity 通过 ingestion-control 调用
  `packages/ingestion-kernels-rs`；
- activity 只向 Temporal 返回结果引用和有界摘要，详细产物进入对象存储；
- Temporal 维护执行状态、重试、超时、心跳、取消和任务分发；
- PostgreSQL 只保存产品和运维查询需要的有界任务投影，以及 Official Web 下一次抓取需要的最新
  网址状态；
- 长 activity 使用心跳报告有界进度，取消必须传播到外部请求和产物写入；
- 来源采集与知识发布分离，采集成功不会自动开放在线查询目标。

任务字段、版本、执行器和对象路径由 schema、注册表及实现维护，不由 ADR 固定。

## 结果

- 执行生命周期只有 Temporal 一个持久编排系统；
- 页面、附件和详细观测不会扩大 workflow history 或 PostgreSQL 投影；
- 来源适配器和文件内核可以独立演进，不改变任务准入边界；
- 在线发布必须经过独立的规范化、索引、release 和查询目标准入。

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

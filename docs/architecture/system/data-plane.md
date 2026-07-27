---
doc_type: architecture
owner_boundary: ingestion-data-plane
status: active
---

# 采集数据面

## 边界

采集数据面包含注册的确定性文件任务、按 ID 执行的内部门户文件发布采集，以及本地通知采集。
这些入口共享对象存储和来源适配器，但不强行进入同一任务模型。采集完成不会自动创建产品读
模型、知识索引或查询目标。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/ingestion-control` | 注册任务准入、Temporal workflow、Rust kernel 投影；文件发布 workflow 提交与状态查询 | 门户 HTTP、通知同步、在线发布 |
| `apps/source-collector` | 门户 HTTP 会话、文件发布 Activity、本地通知命令、认证检查 | 注册任务准入、PostgreSQL 投影、derived 处理 |
| `packages/ingestion-contracts` | 跨运行时 JSON Schema 与校验器 | 工作流、存储和供应商客户端 |
| `packages/ingest-core` | 对象引用、摘要、registry 与内核输入输出辅助能力 | Temporal、数据库和门户实现 |
| `packages/ingestion-kernels-rs` | 确定性校验与分块 | 网络、数据库、对象存储和工作流编排 |

## 注册任务

```text
带摘要的对象引用
-> ingestion-control 按 registry 冻结 Rust kernel 任务
-> Temporal workflow
-> Rust kernel Activity
-> 对象存储结果
-> PostgreSQL 有界任务投影
```

registry 只声明 Rust kernel。Temporal 维护 workflow 历史、重试、超时、心跳与取消；PostgreSQL
只保存任务查询所需的投影，不保存详细处理过程。结果对象必须通过摘要引用，任务完成不会触发
知识发布。

## 文件发布

```text
获准的内部调用提交精确文件发布 ID
-> ingestion-control 启动每 ID 一个 workflow
-> source-collector Activity
-> source bucket 中的 file 与 source.json
-> Temporal workflow result
```

文件发布 workflow 不是注册任务，不写 PostgreSQL 任务、发布流或检查点，也没有父子 workflow、
TypeScript 物化、离线 release 或 derived 产物。提交方保存响应中的 workflow ID，并通过
ingestion-control 的固定状态接口查询 Temporal 状态。当前 Ops Web 不提供文件发布入口。

## 通知

`source-collector` 本地命令直接请求通知列表与详情，在 source bucket 写每 ID 一个来源对象，
并用同前缀 `_state.json` 保存增量 head、实际采集 ID 范围和历史覆盖日期。通知不进入 Temporal、
PostgreSQL、任务注册表或 Ops API，附件只保存 metadata。

## 认证检查

Kubernetes CronJob 每 30 分钟直接执行 source-collector `auth:check`。该命令只用当前 TGC 建立
门户会话，不触发采集、不写业务状态，也不进入 Temporal。固定 TGC 由部署环境提供；Ops Web 只
替换固定 Secret，并从 Secret annotation 与该 CronJob 原生状态展示更新时间和最近检查结果。
本地开发使用前台 `auth:keepalive` 和忽略的状态文件，不复用线上状态存储。

## 状态分工

- Temporal：注册任务和文件发布 workflow 状态；
- PostgreSQL：注册 Rust 任务投影与 migration journal；
- source bucket：门户通知、通知边界、文件发布原文件和来源 metadata；
- derived bucket：注册 Rust kernel 的确定性输出，不保存内部门户文件发布或通知产物。

部署清单存在只表示期望状态；实际运行以环境仓选择和控制器状态为准。

## 相关文档

- `docs/decisions/adr-0077-ingestion.md`
- `docs/data/internal-portal.md`
- `docs/runbooks/ingestion.md`

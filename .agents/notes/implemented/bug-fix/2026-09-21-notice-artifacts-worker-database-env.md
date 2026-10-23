# Agent Note: 本地 Notice Artifacts Worker 数据库环境

Status: implemented

## 背景

`notice-artifacts-worker` 的托管环境只投影了 Qdrant 和对象存储配置，没有投影
`NOTICES_DATABASE_URL`，因此发布准备 activity 无法连接 owner 数据库。

## 决策

本地 `notice-artifacts-worker` 与 `notice-pipeline-worker` 一样使用当前 worktree 的隔离 owner 数据库，并写入 `NOTICES_DATABASE_SSLMODE=disable` 与 `NOTICES_DATABASE_URL`。

## 未采用方案

- 让 artifacts worker 复用 pipeline worker 的进程环境：两个 Temporal task queue 是独立 Deployment，不能依赖进程间环境共享。
- 在 activity 内拼接数据库连接：数据库 URL 的 owner 和 worktree 选择属于 `dev:init` 环境投影，不属于业务 activity。

## 后果

环境投影补齐后，发布准备 activity 可以读取 owner 数据库；Model Config、Embedding、RustFS、Qdrant
和当前索引仍由 artifact worker 的完整运行合同维护。

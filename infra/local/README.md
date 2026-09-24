# 本地 Compose 环境

## 边界

`infra/local` 只包含本地 Docker Compose 环境，不负责生产部署；staging 与 production runtime
生命周期由 K8s/GitOps 拥有。

每个 compose 文件只负责一个本地边界：

- `docker-compose.dev.yml`：每个 worktree 的 PostgreSQL、RustFS、Qdrant 与 Temporal；
- `docker-compose.execution-runtime.yml`：按需启动本地 Hindsight 与 OTel 诊断依赖；
- `docker-compose.execution-runtime.langfuse.yml`：将本地 Agent trace 转发至 Langfuse 的可选 OTel overlay；
- `docker-compose.qdrant.yml`：本地非 TLS Qdrant；
- `docker-compose.qdrant-tls.yml`：只用于 TLS 检查的 Qdrant 环境。

## 规则

- 不得把 app 或 job 放入 `postgres`、`object-store`、`qdrant` 等依赖 compose；
- 不得在此增加 staging 生命周期脚本，staging 使用 GitOps runbook 与 K8s manifest；
- 只有 runtime 边界确实独立且不能表达为明确 overlay 时，才新增 compose 文件。

`docker-compose.dev.yml` 的服务、数据卷、网络和 project name 由当前 worktree profile 拥有。每个 worktree 使用独立端口和凭据；`pnpm dev:init` 只启动当前 profile，`pnpm dev:destroy` 只清理当前 Compose project，不会影响其他 worktree。

`campus-agent-source-wt-*` 与 `campus-agent-derived-wt-*` 是当前 profile bucket；同一 worktree 的同步或回填仍需保持单写者。

execution-control 与 agent-runtime 不由 Compose 启动。`pnpm dev` 从当前 worktree 源码启动两者，并
使用当前 profile 派生的 loopback 端口、Temporal namespace、数据库和 provider 配置加密密钥；不同
worktree 不共享这两个宿主进程。Temporal 服务和 Temporal PostgreSQL 也按 worktree 独立，业务隔离使用当前 profile namespace。

## 产品本地准备

使用根目录 `pnpm dev:init -- --target <target>` 初始化当前 worktree。初始化按 target 的实际消费者投影及其环境依赖生成配置，
并由各 owner 的 readiness probe 运行缺失的 schema、seed 和 namespace 步骤；它不维护额外 lifecycle journal。
core 与 ops-web target 使用同一完整产品 seed，或通过显式协作者 context/namespace 拉取集群产品数据。
数据库、Docs/图片对象、Qdrant collection 和 current index 按 profile 隔离。已有业务数据需要
显式 `--replace`；初始化前停止该 worktree 的应用。notice-publisher target 仍只初始化通知分类。seed 不创建表，也不维护 migration ledger。internal-portal-collection 和 notice-classifier
只在各自 target 需要时生成运行环境，采集任务不由 Compose 常驻启动。
`pnpm dev:destroy` 只删除确认的 worktree database、derived bucket、
托管环境文件和注册记录，不会为了清理而启动或重建共享容器。依赖 compose 不负责启动 app-api、
Campus Web、Ops Web、execution-control、agent-runtime 或同步任务，也不在容器启动时写入业务 seed。

# 本地 Compose 环境

## 边界

`infra/local` 只包含本地 Docker Compose 环境，不负责生产部署；staging 与 production runtime
生命周期由 K8s/GitOps 拥有。

每个 compose 文件只负责一个本地边界：

- `docker-compose.dev.yml`：共享本地 PostgreSQL 与 RustFS；
- `docker-compose.execution-runtime.yml`：本地 execution-control、agent-runtime、Temporal、
  Hindsight 与 runtime worker；
- `docker-compose.execution-runtime.langfuse.yml`：将本地 Agent trace 转发至 Langfuse 的可选 OTel overlay；
- `docker-compose.ingestion-control.yml`：本地 ingestion-control；
- `docker-compose.qdrant.yml`：本地非 TLS Qdrant；
- `docker-compose.qdrant-tls.yml`：只用于 TLS 检查的 Qdrant 环境。

## 规则

- 不得把 app 或 job 放入 `postgres`、`object-store`、`qdrant` 等依赖 compose；
- 不得在此增加 staging 生命周期脚本，staging 使用 GitOps runbook 与 K8s manifest；
- 只有 runtime 边界确实独立且不能表达为明确 overlay 时，才新增 compose 文件。

`docker-compose.dev.yml` 的 PostgreSQL、RustFS、数据卷和网络是同一台机器上的共享依赖，主
checkout 是它们的 bootstrap/reconcile owner。linked worktree 只复用已经运行且健康、配置 hash
匹配的共享依赖；共享依赖缺失、不健康或配置漂移时，linked worktree 会停止并提示先在主 checkout
运行 `pnpm dev:init`。单个 worktree 不得运行 `docker compose down`、`docker compose down -v` 或
带 `--remove-orphans` 的清理命令，因为这些命令会影响其他 worktree。

`campus-agent-source` 与 `campus-agent-derived` 是共享 bucket；同一来源站点的同步或回填仍需保持
单写者，不因为增加 worktree 而并发执行。

## 产品本地准备

根目录 `pnpm dev:init` 启动或校验共享 PostgreSQL 与 RustFS，确保共享 source、Campus Web 文档
bucket 和当前 worktree 的 derived bucket 存在，在固定文档来源缺失时写入确定性样例，安装 app-api
schema，并显式执行 Dining 本地 migration 与唯一 dev seed。`pnpm dev:destroy` 只删除确认的
worktree database、derived bucket、托管环境文件和注册记录，不会为了清理而启动或重建共享容器。
依赖 compose 不负责启动 app-api、Campus Web、Ops Web 或同步任务，也不在容器启动时写入业务
seed。

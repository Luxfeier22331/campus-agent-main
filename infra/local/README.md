# 本地 Compose 环境

## 边界

`infra/local` 只包含本地 Docker Compose 环境，不负责生产部署；staging 与 production runtime
生命周期由 K8s/GitOps 拥有。

每个 compose 文件只负责一个本地边界：

- `docker-compose.dev.yml`：共享本地 PostgreSQL、RustFS 与 Temporal；
- `docker-compose.execution-runtime.yml`：按需启动本地 Hindsight 与 OTel 诊断依赖；
- `docker-compose.execution-runtime.langfuse.yml`：将本地 Agent trace 转发至 Langfuse 的可选 OTel overlay；
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

execution-control 与 agent-runtime 不由 Compose 启动。`pnpm dev` 从当前 worktree 源码启动两者，并
使用当前 profile 派生的 loopback 端口、Temporal namespace、数据库和 provider 配置加密密钥；不同
worktree 不共享这两个宿主进程。Temporal 服务本身仍是机器级共享依赖，业务隔离使用 namespace。

## 产品本地准备

根目录 `pnpm dev:init` 启动或校验共享 PostgreSQL、RustFS 与 Temporal，确保共享 source、Campus Web
文档 bucket 和当前 worktree 的 derived bucket 存在，在固定文档来源缺失时写入确定性样例，安装 app-api
和 execution-control schema，创建当前 worktree 的 Temporal namespace，并显式执行核心 dev seed。Ops Web
负责内部门户凭据 schema 和定时检查；notice-publisher、internal-portal-collection 和 notice-classifier
通过各自 package 的 `dev:init` 按需准备。采集任务不由 Compose 常驻启动。
`pnpm dev:destroy` 只删除确认的 worktree database、derived bucket、
托管环境文件和注册记录，不会为了清理而启动或重建共享容器。依赖 compose 不负责启动 app-api、
Campus Web、Ops Web、execution-control、agent-runtime 或同步任务，也不在容器启动时写入业务 seed。

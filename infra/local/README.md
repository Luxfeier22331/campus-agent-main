# 本地 Compose 环境

## 边界

`infra/local` 只包含本地 Docker Compose 环境，不负责生产部署；staging 与 production runtime
生命周期由 K8s/GitOps 拥有。

每个 compose 文件只负责一个本地边界：

- `docker-compose.execution-runtime.yml`：本地 execution-control、agent-runtime、Temporal、
  Hindsight 与 runtime worker；
- `docker-compose.execution-runtime.fanout.yml`：测试外部观测目的地时使用的可选 OTel overlay；
- `docker-compose.postgres.yml`：共享本地 Postgres；
- `docker-compose.ingestion-control.yml`：本地 ingestion-control；
- `docker-compose.object-store.yml`：本地 S3-compatible object store；
- `docker-compose.qdrant.yml`：本地非 TLS Qdrant；
- `docker-compose.qdrant-tls.yml`：只用于 TLS 检查的 Qdrant 环境。

## 规则

- 不得把 app 或 job 放入 `postgres`、`object-store`、`qdrant` 等依赖 compose；
- 不得在此增加 staging 生命周期脚本，staging 使用 GitOps runbook 与 K8s manifest；
- 只有 runtime 边界确实独立且不能表达为明确 overlay 时，才新增 compose 文件。

## 产品本地准备

根目录 `pnpm dev:prepare` 启动共享 PostgreSQL、安装 app-api schema，并显式执行 Dining 本地
migration 与唯一 dev seed。依赖 compose 不负责启动 app-api、Campus Web、Ops Web 或同步任务，
也不在容器启动时写入业务 seed。

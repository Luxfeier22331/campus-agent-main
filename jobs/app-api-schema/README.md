# app-api-schema

用于现有部署数据库安装和迁移 App API schema 的历史容器构建上下文。新建或重建的本地数据库改由
`jobs/campus-agent-schema` 安装统一 baseline；本 Job 暂未从 GitOps 退役，但不再是本地 bootstrap
入口。

镜像在构建阶段把 `apps/app-api/ops/db/schema.ts` 及其本地依赖编译为 JavaScript，启动后执行一次
schema 安装并退出。它不是常驻服务，也不维护第二份 migration 实现。运行时 app-api、Dining 同步和
普通数据库角色不使用该镜像的管理凭据。

Better Auth 核心表、插件表和 App API 自有认证表都由同一份 Drizzle schema 与
`drizzle.app_api_migrations` ledger 管理。该 Job 不启动 Better Auth，也不需要
`AUTH_SHELL_ORIGIN` 或 `BETTER_AUTH_SECRET`。

Job 只接受空库或已识别的 pre-Drizzle 基线，并在迁移前核对已应用 migration hash；未知部分状态
或被修改的历史 migration 会直接失败。授权在 migration 完成后独立应用。

```bash
docker build -f jobs/app-api-schema/Dockerfile -t app-api-schema .
```

数据库角色、部署顺序和验证见 `docs/data/postgres-ownership.md` 与 `docs/runbooks/release.md`。

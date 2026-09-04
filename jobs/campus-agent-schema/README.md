# campus-agent-schema

`campus-agent-schema` 是共享 PostgreSQL 数据库的唯一 schema migration Job。它使用 Drizzle 的
`drizzle.campus_agent_migrations` ledger，并由 `campus_agent` owner 连接执行；常驻应用角色不执行
DDL。

Job 只接受标准 PostgreSQL 环境变量：`PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、
`PGSSLMODE` 和 `PGSSLROOTCERT`。运行用户必须是 `campus_agent`。迁移期间使用 PostgreSQL advisory
lock，避免两个 schema Job 同时执行。

`migrations/0000_campus_agent_baseline.sql` 是当前数据库结构基线，包含业务 schema、表、视图、约束、
索引和 ACL，不包含业务数据。校园群组、通知分类、测试用户和 Dining 数据由各自的本地 seed 单独
写入。

当前入口用于新建或重建的本地 worktree 数据库，也由 GitOps 管理的 `campus-agent-schema` Job 使用。
后续结构变化在本目录追加 migration，并继续使用同一 ledger；不得修改已经应用的 baseline。是否已在
某个部署环境应用，以该环境的 schema Job 和统一 ledger 状态为准。

`0002_remove_runtime_personal_memory_compat_views.sql` 只删除个人记忆迁移遗留的三个
`runtime.*` 兼容 View；`execution_control.personal_memory_*` 底层表、数据和权限不变。

旧 runner 的 ledger 和 `execution_config` 如果仍存在，Job 会停止并报告；本 Job 不自动删除它们。
旧 runner 不由标准本地 bootstrap 或 GitOps 调用，只为本地历史数据库集成测试保留。

本地运行：

```bash
pnpm --dir jobs/campus-agent-schema migrate
```

镜像构建：

```bash
docker build -f jobs/campus-agent-schema/Dockerfile -t campus-agent-schema .
```

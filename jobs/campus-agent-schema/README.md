# campus-agent-schema

`campus-agent-schema` 是共享 PostgreSQL 数据库的唯一 schema migration Job。它使用 Drizzle 的
`drizzle.campus_agent_migrations` ledger，并由 `campus_agent` owner 连接执行；常驻应用角色不执行
DDL。

Job 只接受标准 PostgreSQL 环境变量：`PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、
`PGSSLMODE` 和 `PGSSLROOTCERT`。运行用户必须是 `campus_agent`。迁移期间使用 PostgreSQL advisory
lock，避免两个 schema Job 同时执行。

`migrations/20260827151741_0000_campus_agent_baseline/migration.sql` 是当前数据库结构基线，包含业务 schema、表、视图、约束、
索引和 ACL，不包含业务数据。校园群组、通知分类、测试用户和 Dining 数据由各自的本地 seed 单独
写入。

当前入口用于新建或重建的本地 worktree 数据库，也由 GitOps 管理的 `campus-agent-schema` Job 使用。
后续结构变化在本目录追加 migration，并继续使用同一 ledger；不得修改已经应用的 baseline。是否已在
某个部署环境应用，以该环境的 schema Job 和统一 ledger 状态为准。

`0002_remove_runtime_personal_memory_compat_views.sql` 只删除个人记忆迁移遗留的三个
`runtime.*` 兼容 View；`execution_control.personal_memory_*` 底层表、数据和权限不变。

旧 runner 的 ledger 和 `execution_config` 如果仍存在，Job 会停止并报告；本 Job 不自动删除它们。
旧 runner 不由标准本地 bootstrap 或 GitOps 调用。需要从旧数据库切换到统一 ledger 时，先按环境维护窗口
停止写入并完成数据/旧对象处置，再运行本 Job；它不是无条件的原位兼容升级器。

迁移目录是 SQL-first：历史迁移目录名保留 UTC 时间戳和显式序号，目录内只有不可变的 `migration.sql`；
新迁移只需使用 UTC 时间戳和小写 snake_case 名称，不再人工维护序号。Drizzle
ORM `1.0.0-rc.4` 负责读取目录、升级旧统一 ledger 的记录格式并执行 SQL；不再提交 Drizzle Kit journal 或 snapshot。
已应用 SQL 不得格式化、重排或覆盖。

`status` 按具名记录和 SQL hash 返回具体 `pendingMigrations`；旧统一 ledger 即使条数相同也报告
`pending`，因为它还没有完成具名升级。`migrate` 先匹配历史、在同一 advisory lock 内执行原生
migrator，再检查无遗漏才返回 `applied` 或 `current`。原生 ledger 升级与待执行 SQL 的事务不是一个
事务；SQL 失败时回滚本批 DDL，重新运行会按缺失名称继续，不把 ledger 格式升级误报为 schema 已完成。

创建新 SQL 不连接数据库：

```bash
pnpm --dir jobs/campus-agent-schema new add_example_column
```

名称应为小写 snake_case；同名同秒创建会失败，不覆盖已有文件。填入 SQL 后同步所属应用 schema 并
运行迁移集成测试。历史目录中的序号仅用于识别和审计，所有目录的执行顺序由完整目录名决定。

遗漏的个人记忆迁移修复涉及开发数据硬切，先按 `docs/runbooks/execution.md` 完成目标环境维护步骤；
不能直接把自动补跑用于仍在写入的旧个人记忆服务。

本地运行：

```bash
pnpm --dir jobs/campus-agent-schema migrate
pnpm --dir jobs/campus-agent-schema status
pnpm --dir jobs/campus-agent-schema test
pnpm --dir jobs/campus-agent-schema test:migration-integration
```

镜像构建：

```bash
docker build -f jobs/campus-agent-schema/Dockerfile -t campus-agent-schema .
```

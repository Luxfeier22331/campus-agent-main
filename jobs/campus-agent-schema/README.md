# campus-agent-schema

共享 PostgreSQL 数据库的 schema migration Job。使用 Drizzle 的
`drizzle.campus_agent_migrations` ledger，由 `campus_agent` owner 连接执行；常驻应用角色不执行
DDL。

## 运行

只接受标准 PostgreSQL 环境变量：`PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、
`PGSSLMODE` 和 `PGSSLROOTCERT`。运行用户必须是 `campus_agent`。迁移期间使用 advisory lock，
避免两个 schema Job 同时执行。

```bash
pnpm --dir jobs/campus-agent-schema migrate   # 执行迁移
pnpm --dir jobs/campus-agent-schema status    # 查看状态
pnpm --dir jobs/campus-agent-schema new xxx   # 新建迁移（不连数据库）
```

`status` 按具名记录和 SQL hash 返回具体 `pendingMigrations`；`migrate` 先匹配历史、在同一
advisory lock 内执行原生 migrator，再检查无遗漏才返回 `applied` 或 `current`。SQL 失败时回滚
本批 DDL，重新运行会按缺失名称继续。

## 迁移目录

`migrations/` 下每个目录是一个不可变迁移，目录名格式为 `YYYYMMDDHHMMSS_snake_case_name`
（UTC 时间戳 + 小写描述）。目录内只有 `migration.sql`。已应用的 SQL 不得修改、重排或格式化。

新建迁移不连接数据库：

```bash
pnpm --dir jobs/campus-agent-schema new add_example_column
```

名称应为小写 snake_case；同名同秒创建会失败，不覆盖已有文件。填入 SQL 后同步所属应用 schema
并运行迁移集成测试。

个人记忆状态由独立数据库的 `memory` schema 拥有，使用 `--target memory` 及
`memory_service` owner 执行迁移。主库新迁移退役旧状态表，不复制或重置独立 Memory 数据。

本地运行：

```bash
pnpm --dir jobs/campus-agent-schema migrate
pnpm --dir jobs/campus-agent-schema status
pnpm test --filter=campus-agent-schema
pnpm --dir jobs/campus-agent-schema test:migration-integration
```

## 镜像构建

```bash
docker build -f jobs/campus-agent-schema/Dockerfile -t campus-agent-schema .
```

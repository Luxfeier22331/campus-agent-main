# app-api-schema

用于安装和迁移 app-api 共享 PostgreSQL schema 的容器构建上下文。

镜像复用 `apps/app-api/ops/db/schema.ts` 及其 migration 文件，启动后执行一次 schema 安装并退出。
它不是常驻服务，也不维护第二份 migration 实现。运行时 app-api、Dining 同步和普通数据库角色不
使用该镜像的管理凭据。

```bash
docker build -f jobs/app-api-schema/Dockerfile -t app-api-schema .
```

数据库角色、部署顺序和验证见 `docs/data/postgres-ownership.md` 与 `docs/runbooks/release.md`。

# notice-database

`packages/notice-database` 拥有通知类 Job 共享的 PostgreSQL 连接配置和连接池创建。

负责：

- 解析 `NOTICES_DATABASE_URL`（或 `PG*` 环境变量组合），拒绝连接串内嵌 TLS 参数；
- 按 `NOTICES_DATABASE_SSLMODE` 校验 TLS 边界：`verify-full` 要求
  `NOTICES_DATABASE_CA_CERT_PATH` 指向非空 CA 证书，`disable` 只允许本地、开发或测试
  环境；
- 提供 `createNoticeDatabasePool` 供消费方按需覆盖 pool 选项。

环境变量在各 Job 的托管 `.env.local` 中的归属见 `docs/environment/env.md`。本包不拥有
schema 迁移、查询语句和业务写入逻辑。消费者为 `jobs/notice-classifier`、
`jobs/notice-publisher` 和 `jobs/notice-index-publisher`。

```bash
pnpm --dir packages/notice-database typecheck
pnpm --dir packages/notice-database test
```

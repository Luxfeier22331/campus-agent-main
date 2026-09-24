# notice-database

`packages/notice-database` 拥有通知类 Job 共享的 PostgreSQL 连接配置和连接池创建。

负责：

- 解析 `NOTICES_DATABASE_URL`（或 `PG*` 环境变量组合），拒绝连接串内嵌 TLS 参数；
- 按 `NOTICES_DATABASE_SSLMODE` 校验 TLS 边界：`verify-full` 要求
  `NOTICES_DATABASE_CA_CERT_PATH` 指向非空 CA 证书，`disable` 只允许本地、开发或测试
  环境；
- 提供 `createNoticeDatabasePool` 供消费方按需覆盖 pool 选项。

环境变量在各 Job 的托管 `.env.local` 中的归属见 `docs/environment/env.md`。本包不拥有
schema 迁移；共享处理接口提供分类/发布操作族的会话锁和当前问题写入。锁竞争返回 skipped，
连接失效通知消费者停止取新工作，回调结束后才释放锁。当前问题按通知和阶段唯一保存，业务 owner
在成功写入的同一事务中清除问题。消费者为 `jobs/notice-classifier`、
`jobs/notice-publisher` 和 `jobs/notice-index-publisher`。

```bash
pnpm --dir packages/notice-database typecheck
pnpm test --filter=@campus-agent/notice-database
```

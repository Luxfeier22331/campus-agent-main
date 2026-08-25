# 通知发布器

`notice-publisher` 发布已经登记且已有分类的通知。默认读取 `notices.notices` 中
`category IS NOT NULL AND is_published=false` 的行，从 source bucket 清洗正文并校验资源，在一个事务
中写入正文、资源 metadata，并设置 `is_published=true`。分类由数据库维护，publisher 不修改分类。

```bash
pnpm --filter notice-publisher migrate
pnpm --filter notice-publisher publish
pnpm --filter notice-publisher publish -- --notice-id 123456
```

显式指定已发布通知时会重新校验来源正文和资源；来源 metadata 或已发布内容冲突时失败。外链通知只
发布来源 metadata 和 URL。图片写入 derived bucket，附件字节继续保留在 source bucket。

数据库连接使用 `NOTICES_DATABASE_URL` 或标准 `PG*`，对象存储使用 source 读取身份和 derived 图片
写入身份。Kubernetes 模板默认暂停，只用于一次性发布。

```bash
pnpm --filter notice-publisher typecheck
pnpm --filter notice-publisher test
pnpm --filter notice-publisher test:migration-integration
```

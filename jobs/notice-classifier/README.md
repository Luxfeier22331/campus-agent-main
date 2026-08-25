# 通知分类 Job

该包提供一次性标题分类 Job。在线入口直接读取 `notices.notices` 中 `category IS NULL` 的通知，
只把原始标题交给当前模型，并把分类写回同一行。它不读取正文、不访问对象存储，也不触发发布。

默认运行分类所有待分类通知；重复 `--notice-id` 只处理指定通知，并允许用明确操作覆盖已有分类：

```bash
node jobs/notice-classifier/dist/cli.js
node jobs/notice-classifier/dist/cli.js --notice-id 123456 --concurrency 2
```

默认批量分类使用条件更新，分类过程中发生的人工修改不会被覆盖，并计入 `skipped`。显式单条分类
以最后完成的明确操作为准。数据库连接使用 `NOTICES_DATABASE_URL` 或标准 `PG*`，TLS 使用
`NOTICES_DATABASE_SSLMODE` 与 `NOTICES_DATABASE_CA_CERT_PATH`。

模型配置从 Model Config 的 `notice_classification` 设置读取。`pnpm notice:classify:job:local` 使用同一
数据库实现；`pnpm notice:classify` 继续作为 source→JSONL 的离线模型比较工具，但其输出不进入线上
发布链路。

本地运行在新 worktree 中先由 schema owner 安装通知 migration，再生成分类器环境：

```bash
pnpm --filter notice-publisher dev:init
pnpm --filter notice-classifier dev:init
```

Kubernetes 模板默认暂停，只用于维护者创建一次性 Job。

```bash
pnpm --filter notice-classifier typecheck
pnpm --filter notice-classifier test
pnpm --filter notice-classifier build
```

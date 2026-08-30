# 通知分类 Job

该包提供一次性标题分类 Job，从 `notices.notices` 读取通知标题并把分类写回同一行。它不读取正文或
对象存储，也不触发通知发布。

## 入口

- `src/cli.ts`：生产 Job 入口；
- `src/local-cli.ts`：使用本地数据库验证同一分类实现；
- `src/job.ts`：待分类选择、并发执行和条件写回。

## 相关文档

- 本地与 Kubernetes 操作：`docs/runbooks/ingestion.md`
- 离线分类与模型评测：`scripts/notices/README.md`
- 模型配置所有权：`docs/environment/providers.md`
- 通知数据：`docs/data/notices.md`

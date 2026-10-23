# 通知分类 Job

该包提供一次性通知标签 Job，从 `notices.notices` 读取内部通知的栏目与标题，先走
`notice-classifier-core` 的规则车道，未命中的交给 Model Config 选中的决策模型或 LLM，把 `label_category`
与 `label_intent` 写回同一行。它不读取正文或对象存储，也不触发通知发布。

## 入口

- `src/cli.ts`：生产 Job 入口；
- `src/local-cli.ts`：使用本地数据库验证同一分类实现；
- `src/job.ts`：缺失、全量与指定三种范围的选择、规则车道与模型分类、并发执行和条件写回。
- `src/eval-cli.ts` 与 `eval/`：按标准答案与固定输入评测规则车道与指定后端，不读写数据库；`eval/` 为 internal-only 数据。

## 相关文档

- 本地与 Kubernetes 操作：`docs/runbooks/ingestion/ingestion.md`
- 标签体系、判定文本与车道规则：`.agents/notes/proposed/feature/2026-10-21-notice-classification-redesign.md`
- 模型配置所有权：`docs/environment/providers.md`
- 通知数据：`docs/data/notices.md`

自动批次排除 `notices.processing_failures` 中的分类问题，模型输出无效时记录当前问题并继续其他通知；
连接、供应商等基础设施错误终止本轮。显式单条重试成功或 Ops 人工修改有效分类时原子清除问题。
CLI 与本地入口共用分类会话锁，已被占用时输出 `skipped`，不计作分类成功。

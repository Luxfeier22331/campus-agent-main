# public-docs-rspress

用于本地评估 `Rspress` donor shell 与 campus-agent 真实公开文档的适配效果。

常用命令：

```bash
pnpm --filter public-docs-rspress sync:real-docs
pnpm --filter public-docs-rspress dev
pnpm --filter public-docs-rspress build
```

说明：

- `sync:real-docs` 会从本机 object storage 的 `campus-rag-derived` bucket 拉取真实公开文档。
- `student_rules` 直接消费真实 `canonical.md`。
- `curriculum_plan` 直接消费真实 `document-units.jsonl`，仅过滤页码并重组为 Markdown。
- `curriculum_plan` 的课程地图额外消费对象存储中的 `reader-assets/course-maps.json` 与区域图，不再依赖 repo-tracked 审核清单。

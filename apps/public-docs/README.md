# public-docs

`public-docs` 是已退出 forward product topology 的历史文档站实现。

当前长期文档入口是 `campus-web /docs/*`，由 campus-web 交付 Rspress-powered
canonical reader。`public-docs` 仅保留为 reference implementation，用于迁移或对照：

- Rspress / MDX reader 生成管线
- stable anchor 与 `data-root-unit-id` highlight 结构
- published reader asset sync 经验
- docs search mapping 与 theme ideas

不要把本 package 作为新的 staging deploy、product acceptance、browser route owner 或账号导航
owner。需要开发当前文档阅读面时，使用 `apps/campus-web`：

```bash
pnpm --filter campus-web docs:sync:published-reader
pnpm --filter campus-web docs:build
pnpm --filter campus-web dev
```

本 package 下的命令和 `PUBLIC_DOCS_*` 环境变量是历史实现的命名，保留用于迁移参考和旧
pipeline 审计，不代表 `apps/public-docs` 仍是目标产品入口。

相关当前文档：

- `docs/decisions/adr-0051-campus-docs-rspress-reader-surface.md`
- `docs/architecture/system/document-site-architecture.md`
- `docs/runbooks/document-reader-publish-and-docs-deploy-runbook.md`

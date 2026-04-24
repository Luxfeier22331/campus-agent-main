# public-docs

`public-docs` 是 `campus-agent` 的正式公开文档站 app，当前采用 `Rspress` 壳承载公开文档阅读、导航与信息架构验证。

常用命令：

```bash
pnpm --filter public-docs sync:real-docs
pnpm --filter public-docs dev
pnpm --filter public-docs dev:real-docs
pnpm --filter public-docs build
pnpm --filter public-docs build:real-docs
```

说明：

- `sync:real-docs` 用于同步当前公开文档产物，生成本地 docs shell 的公开阅读样本。
- `docs/student-handbook/`、`docs/curriculum-plan/`、`docs/campus-regulations/`、`docs/public/course-maps/`
  与 `src/generated/` 是本地同步产物，必须保持 ignored，不作为 repo source truth 手工提交。
- `dev:real-docs` / `build:real-docs` 是真实文档预览与验收入口；普通 `dev` / `build`
  只补齐可构建的空 collection scaffold，不隐式访问对象存储，用于文档站壳本身的快速开发与 CI
  构建。
- 当前 shell 已经提升为正式 `public-docs` app；旧的 Fumadocs 壳已废弃。
- 当前实现仍处于 document-site workstream 的持续收口阶段，不应把本地同步路径误解为 browser runtime 的长期真相。
- 长期 reader truth、published reader assets 与 same-site docs control-plane 以
  `docs/architecture/system/document-site-architecture.md` 和对应 contracts 为准。

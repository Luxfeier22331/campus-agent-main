# public-docs

`public-docs` 是 `campus-agent` 的正式公开文档站 app，当前采用 `Rspress` 壳承载公开文档阅读、导航与信息架构验证。

常用命令：

```bash
pnpm --filter public-docs sync:real-docs
pnpm --filter public-docs dev
pnpm --filter public-docs build
```

说明：

- `sync:real-docs` 用于同步当前公开文档产物，生成本地 docs shell 的公开阅读样本。
- 当前 shell 已经提升为正式 `public-docs` app；旧的 Fumadocs 壳已废弃。
- 当前实现仍处于 document-site workstream 的持续收口阶段，不应把本地同步路径误解为 browser runtime 的长期真相。
- 长期 reader truth、published reader assets 与 same-site docs control-plane 以
  `docs/architecture/system/document-site-architecture.md` 和对应 contracts 为准。

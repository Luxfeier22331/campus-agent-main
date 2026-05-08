# public-docs

`public-docs` 是 `campus-agent` 的正式公开文档站 app，当前采用 `Rspress` 壳承载公开文档阅读、导航与信息架构验证。

常用命令：

```bash
pnpm --filter public-docs sync:real-docs
pnpm --filter public-docs dev
pnpm --filter public-docs dev:live-smoke
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
- `dev:live-smoke` 是本地同站 docs runtime smoke 入口：它以 `public-docs` Worker 作为主 surface，
  并在同一个 Wrangler dev session 中带起 `apps/app-api` local-smoke Worker，使
  `/api/docs/*` 的 service binding 命中真实本地 Worker runtime，而不是依赖两个分离会话互相发现。
  由于它消费的是 Worker `ASSETS` 静态目录，命令会先执行一次 `build`，再启动本地 smoke 拓扑。
- `public-docs /readyz` 在本地与部署态都只探测 `app-api /api/docs/readyz`，它表达的是
  document reader control-plane readiness，不等于整个 `app-api` 产品 runtime readiness。
- 当前 shell 已经提升为正式 `public-docs` app；旧的 Fumadocs 壳已废弃。
- 当前实现仍处于 document-site workstream 的持续收口阶段，不应把本地同步路径误解为 browser runtime 的长期真相。
- 长期 reader truth、published reader assets 与 same-site docs control-plane 以
  `docs/architecture/system/document-site-architecture.md` 和对应 contracts 为准。

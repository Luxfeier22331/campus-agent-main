---
doc_type: adr
status: accepted
created: 2026-06-10
updated: 2026-06-12
---
# ADR-0051: Campus Docs Rspress Reader Surface

## Context

`campus-web` 已经成为学生侧统一产品入口与 account browser shell。文档阅读需要和 Q&A
source card、docs search、账号态、地图/饭堂/反馈支撑页共享同一个 `campus.muc.wiki`
产品上下文。

当前 `campus-web /docs/*` React 页面只能 resolve reader asset 并展示标题/外链，不能承担成熟
docs reader。旧 `apps/public-docs` 已经证明 Rspress + generated MDX + stable anchor +
`data-root-unit-id` highlight + docs search mapping 的技术路线可行，但它不再应该作为独立
product surface 决定目标拓扑。

## Decision

- `campus-web /docs/*` 是最终文档产品入口。
- Rspress 是 `campus-web` 文档阅读面的 reader/render engine；Pagefind 是公开文档静态搜索
  engine。
- `app-api` 继续拥有 canonical document truth、publish manifest、restricted / gated
  navigation/search/resolve/versions/admission 与 source-card permalink shaping。
- published reader assets 继续是正文发布产物；Rspress build 消费这些 reader projection /
  generated MDX，不成为 canonical truth。
- Q&A source card、docs search result 与直接阅读必须共用 reader permalink：
  `/docs/:corpus/:collection/:docSlug`、`/v/:versionSlug`、`?hl=rootUnitId`、
  `#anchor`。
- public published docs search 默认使用 Pagefind static index；只有需要
  principal-specific visibility 裁剪的 restricted / gated search 进入 `/api/docs/*`。
- 当前 `/api/docs/*` search 实现仍是 public current only，不作为公开文档站热路径；真正开放
  restricted / gated search 时必须先演进为 principal-aware visible search。
- 旧 `apps/public-docs` 退出 forward product topology，仅作为可迁移 reference
  implementation。

## Consequences

- 不继续扩展 `campus-web` 自研完整 docs reader。
- 不复活独立 `public-docs` browser surface 作为长期文档入口。
- `campus-web` build / deploy gate 必须覆盖 Rspress docs build。
- Reader state enhancer、MDX generator、Pagefind sidecar / docs search mapping 可以从旧
  `apps/public-docs` 迁移，但必须改挂到 campus product shell 与同源 route。
- 更换 reader engine 必须更新本 ADR、document-site architecture、contract tests 与 build
  checks。

## Non-Goals

- 不修改 `/api/docs/*` HTTP endpoint path。
- 不修改 reader permalink 语义。
- 不把 docs search 做成 chat answer API。
- 不把 reader asset resolve 改成每次返回整篇正文的 API。

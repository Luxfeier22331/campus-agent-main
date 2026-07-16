---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0051
status: accepted
---
# ADR-0051 Campus Docs Rspress 阅读器

## 背景

`campus-web` 已经成为学生侧统一产品入口与 account browser shell。文档阅读需要和 Q&A
source card、docs search、账号态、地图/饭堂/反馈支撑页共享同一个 `campus.muc.wiki`
产品上下文。

当前 `campus-web /docs/*` 需要承担成熟 docs reader。历史 `apps/public-docs`
已验证 Rspress + generated MDX + stable anchor + `data-root-unit-id` highlight +
docs search mapping 的技术路线可行，但该独立 app 已删除，后续只能通过 git history
追溯迁移来源。

## 决策

- `campus-web /docs/*` 是最终文档产品入口。
- Rspress 是 `campus-web` 文档阅读面的 reader/render/search integration shell；公开
  current 文档搜索使用 Rspress native local search。
- `app-api` 继续拥有 canonical document truth、publish manifest、restricted / gated
  navigation/search/resolve/versions/admission 与 source-card permalink shaping。
- published reader assets 继续是正文发布产物；Rspress build 消费这些 reader projection /
  generated MDX，不成为 canonical truth。
- Q&A source card、docs search result 与直接阅读必须共用 reader permalink：
  `/docs/:corpus/:collection/:docSlug`、`/v/:versionSlug`、`?hl=rootUnitId`、
  `#anchor`。
- anonymous-visible current docs search 默认使用 Rspress native local search，只索引
  `docsSearchVisibility=public_current` 的 published reader pages。
- Rspress runtime JS / CSS / public local search index 统一交付在
  `/_docs-static/*`，不得占用 campus shell 的通用 `/static/*` namespace。
- restricted / gated search 默认使用受同源 Worker admission 保护的
  `/_gated-docs-search/*` static index，并在 browser 本地执行字面查询；查询词不发送到
  app-api。
- `/api/docs/collections/:corpus/:collection/search` 从 browser-facing docs HTTP
  contract 退役；campus-web Worker 不再 allowlist 该 endpoint，public-docs 也不得保留旧
  search hook。
- docs site search 只做精确 / 字面命中；同义词、别名、意图扩展与语义检索属于 RAG/chat
  能力，不进入文档站本地搜索。
- 旧 `apps/public-docs` 退出 forward product topology，并从 active workspace 删除。

## 后果

- 不继续扩展 `campus-web` 自研完整 docs reader。
- 不复活独立 `public-docs` browser surface 作为长期文档入口。
- `campus-web` build / deploy gate 必须覆盖 Rspress docs build。
- Reader state enhancer、MDX generator 与 docs search mapping 已改挂到 campus product
  shell 与同源 route；后续不得恢复独立 public-docs app。
- 更换 reader engine 必须更新本 ADR、document-site architecture、contract tests 与 build
  checks。

## 不负责

- 不修改 reader resolve / versions / navigation / admission 的 `/api/docs/*`
  endpoint path。
- 不修改 reader permalink 语义。
- 不把 docs search 做成 chat answer API。
- 不把 reader asset resolve 改成每次返回整篇正文的 API。

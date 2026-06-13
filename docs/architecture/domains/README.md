---
doc_type: index
truth_scope: repository
owner_boundary: docs/architecture/domains
status: active
created: 2026-04-23
updated: 2026-06-12
---
# Domain Architecture

`domains/` 承接领域 supporting architecture。它负责某个业务域自己的长期边界、
owner、runtime shape 与 forbidden shapes。

## 当前领域

- `navigation/architecture.md`
  - 校园导航 / spatial truth / wayfinding capability boundary
- `official-web/architecture.md`
  - public official-web source channel、control plane 与 serving split
- `official-web/freshness-and-incremental-crawling.md`
  - official-web freshness / incremental crawling supporting truth
- `official-web/serving-and-news-retrieval-strategy.md`
  - official-web reference/news surface serving strategy
- `authenticated-notice/architecture.md`
  - authenticated notice source channel、source/data plane 与 regulation downstream
- `campus-services/architecture.md`
  - campus services structured runtime、projection-backed query seam 与 opening gate

## 与 `docs/domains/` 的关系

- `docs/architecture/domains/`
  - 只放 architecture 文档
- `docs/domains/`
  - 聚合同一领域下的 ADR、contract、data、runbook、reference、planning 入口

## 使用规则

- 领域 supporting architecture 只冻结领域边界，不替代跨文档类型导航
- 如果一个文档主要冻结 canonical data/schema，应放回 `docs/data/`
- 如果一个文档主要冻结 HTTP/runtime seam，应放回 `docs/contracts/`

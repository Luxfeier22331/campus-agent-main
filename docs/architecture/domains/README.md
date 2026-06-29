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
  - 校园导航 / spatial truth / wayfinding tool boundary
- `official-web/architecture.md`
  - public official-web source channel、control plane、freshness 与 serving split
- `authenticated-notice/architecture.md`
  - authenticated notice source channel、source/data plane 与 regulation downstream
- `campus-services/architecture.md`
  - campus services tool read model、projection-backed query seam 与 opening gate
- `dining/architecture.md`
  - dining floor/window/stall/menu、ops draft/release candidate/release 与
    student published projection boundary

## 与 `docs/domains/` 的关系

- `docs/architecture/domains/`
  - 只放 architecture 文档
- `docs/domains/`
  - 放领域入口；宽领域通常聚合 ADR、contract、data、runbook、reference
    入口，窄能力可以作为一个 canonical human document 承载完整说明

## 使用规则

- 领域 supporting architecture 只冻结领域边界，不替代跨文档类型入口或窄能力说明
- 如果一个文档主要冻结 canonical data/schema，应放回 `docs/data/`
- 如果一个文档主要冻结 HTTP/runtime seam，应放回 `docs/contracts/`

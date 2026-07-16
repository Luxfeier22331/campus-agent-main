---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0024
status: accepted
---
# ADR-0024 认证通知来源

## 背景

需要认证的校内门户与公开网站具有不同的身份、访问和采集语义。把它作为 `official_web`
会混合公开 crawl policy 与依赖 session 的来源采集。

## 决策

校内门户是一级 source channel。ADR-0063 将其命名为 `internal_portal`；`notice` 和
`file_release` 是其下两个独立 source surface。

notice 是稳定 source unit。source identity 基于 portal 与 notice identity；正文、metadata
或 attachment relation 发生实质变化时产生新 source version。file release 保持自己的
source-unit contract，不转换为 notice。

来源采集由 `apps/source-collector` 的 internal-portal adapter 拥有。它采集 provider
response、normalized source block、attachment reference 和已验证 attachment bytes，随后
通过共享 Temporal ingestion workflow 返回一个 digest-pinned source manifest。

collector 不拥有 canonical document、OCR、regulation promotion、chunking、indexing 或
query publication。crawler local state 和 provider export 是实现状态，不是仓库 source
truth。

成功认证采集不代表 notice 可查询。下游产品必须同时补齐 normalization、authorization、
freshness、publication、runtime contract 和 evaluation 后才能开放。

## 后果

- `internal_portal.notice.capture` 和 `internal_portal.file_release.capture` 使用共享
  ingestion task 和 object-reference contract。
- source bytes 保存在 source bucket；PostgreSQL 只保存有界共享 task projection。
- app-api 不提供 notice collector command、ledger 或 query surface。
- `official_web` 继续作为独立公开 source channel。

## 相关文档

- `docs/decisions/adr-0063-internal-portal.md`
- `docs/decisions/adr-0077-ingestion.md`
- `docs/architecture/system/data-plane.md`
- `docs/data/internal-portal.md`

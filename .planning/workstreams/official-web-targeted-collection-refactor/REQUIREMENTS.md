---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Targeted Collection Refactor

## Goal

把 official web collector 从 broad crawl executor 重构为 target-first acquisition executor。

成功后，默认采集只覆盖已声明、已准入、下游会消费的目标信息，例如联系方式、办理指南、稳定参考页面和 inventory-only public notice cards。允许抓取的 host 不再自动等于应该抓取或应该 handoff 的内容。

## Problem Statement

当前实现已有 `app-api` control plane、source-truth artifact、consumer-denominator 与 ingestion handoff，但主要路径仍是：

`host/seed/budget -> crawl -> page extraction -> consumer-denominator filter -> retained bundle`

这导致：

- `target-source-map` 只是加载和校验，未真正驱动 frontier。
- `hosts.json` 中 33 个 enabled hosts 仍表达 broad crawl 能力。
- scheduler lane 可以收窄默认执行，但不是强制 target admission。
- collector CLI / programmatic `crawlSite` 当前仍可在缺少 target workset 时从 enabled hosts 推导执行面。
- collector 过早承担 consumer family / evidence 判断。
- dynamic shell discovery 是 host 特例，不是 target job state。
- ingestion selected-write / release gate 与采集计划之间缺少 first-class target job lineage。

## Scope

- 重写 official-web target declaration contract。
- 让 `app-api` 拥有 target job、candidate URL、attempt、artifact verification projection 与 handoff eligibility truth。
- 重构 `/api/official-web/plans:resolve` 为 target-scoped workset resolver。
- 重构 collector 执行入口，让它只执行 app-api 下发的 workset。
- 保留 `capture/`、`provider/`、`source-truth/` artifact 分层，但补齐 target lineage metadata。
- 让 ingestion-worker 按 target candidate / stable reference / inventory-only public notice 分流。
- 让 panel 展示 target job 到 ingestion/release 的 operator-safe read model。
- 增加 no-promotion live seam 验收，证明不写 current truth 也能完整走完采集到 staging。

## Non-Goals

- 不打开 `fresh_news` / `news_archive` query-serving 或 notice runtime。
- 不把 all official-web pages 导入默认 RAG。
- 不将 collector 嵌入 ingestion-worker。
- 不新增独立 crawler-intake backend。
- 不让 panel 读对象存储、worker local JSON、collector output dir 或 telemetry sink。
- 不改变 public-chat / supervisor runtime routing。
- 不引入外部 workflow runtime 作为本阶段前置条件。
- 不引入 `public_notice_inventory`、`fresh_news_candidate` 或其他新的 notice family 别名。
- 不创建独立于 shared source-handoff 状态机的第二套 artifact verification canonical truth。

## Success Criteria

- Broad crawl 默认入口被 fail-closed 或降级为显式 operator/debug path。
- `target-source-map` 成为 target job admission 的 canonical input。
- 默认计划必须能解释每个 URL 为什么被抓、服务哪个 target、需要什么 evidence。
- collector 在没有 app-api target workset 时不能自动从 enabled hosts 扩张。
- retained source-truth bundle 中每个 page 都有 target lineage 或明确的 inventory-only / rejected reason。
- ingestion replay 能按 target family 输出 candidate/review/stable-reference projection，不把 inventory-only 写成 promotable。
- selected-write / release gate 仍由 ingestion 层执行，collector 不能绕过。
- panel 能看到 target job、attempt、artifact verification、projection/review/release status。
- no-promotion live seam 证明：
  `collector -> app-api lifecycle -> object storage -> handoff receiver -> ingestion staging`
  可重复执行且不 promotion current truth。

## Canonical Naming

本 workstream 必须复用现有 canonical names：

- official-web collector retention family: `notice_news_candidate`
- notice consumption source family: `official_web_public_notice`
- inventory-only 是 materialization / retention policy，不是新的 consumer family 或 source family

如需在 operator UI 中展示“public notice inventory”，只能作为 label 或 target id，不得进入 wire contract enum。

## Wire Contract Convention

- Repo-tracked JSON config 继续使用现有 snake_case 输入格式，由 `official-web-core` load 成 camelCase model。
- Runtime artifact / source-truth / app-api response 的 TypeScript-owned JSON 继续使用现有 camelCase wire keys，例如 `schemaVersion`、`normalizedCanonicalUrl`、`pageManifestObjectKey`。
- Phase 1/5 必须补 contract fixture，证明 target lineage 字段在 collector artifact、app-api parser 与 ingestion replay 之间一致。

## Source-Handoff Ownership

Artifact verification 的 canonical truth 必须复用 shared source-handoff 状态机：

- `SourceHandoff`
- `SourceObjectRef`
- `ObjectVerification`
- `IngestionExecution`

Phase 2 可以在 app-api target job/operator projection 中展示 verification summary，但不得新增同义 canonical verification ledger。

## Acceptance Gates

必需 gates：

- docs lint:
  `pnpm docs:lint`
- official-web collector tests:
  `pnpm --dir apps/official-web-collector test`
- app-api official-web tests:
  `pnpm --dir apps/app-api test -- official-web`
- app-api Worker runtime tests:
  `pnpm --dir apps/app-api test:worker -- official-web`
- app-api shared DB integration lane when schema or query behavior changes:
  `pnpm --dir apps/app-api test:shared-db-integration -- official-web`
- ingestion official-web tests:
  `uv run --all-packages python -m unittest tests.ingestion.test_official_web_handoff_consumer tests.ingestion.test_official_web_handoff_receiver`
- targeted no-promotion live seam:
  command to be frozen in Phase 8 after runtime entrypoints are implemented

仓库级收口前补充：

- `pnpm web:lint`
- `pnpm web:typecheck`
- `pnpm web:test:worker`
- `pnpm web:test:integration`
- `uv run --all-packages ruff check .`
- `uv run --all-packages ruff format . --check`
- `uv run --all-packages python -m unittest discover -s tests -t .`

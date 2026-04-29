---
doc_type: index
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Workstream: Public Docs Rolling Publish Automation

这是 `public-docs-rolling-publish-automation` 的 native workstream 入口。

它负责把 ingestion 侧维护的 public docs publish manifest 变更，转成可审计、可跳过、可回滚的
`apps/public-docs` rolling publish 流程。

## Current Status

- status: `active`
- current phase: `Phase 2 needs plan`
- current focus: Phase 1 已完成 manifest check CLI、release ledger、dry-run verdict、
  validation gates、测试与 runbook wiring；下一步规划 scheduled runner 与 single-flight lock。

## Scope Boundary

这条线只负责发布编排，不重开文档站 reader / shell / canonical 内容模型。

- 文档站 UI、reader 组件、来源展示与 canonical reader consumption 继续属于
  `document-site-and-canonical-reader`。
- manifest 由 ingestion / publish pipeline 维护；`public-docs` 不扫描对象存储决定公开子集。
- browser runtime 不直连对象存储，不把对象存储作为运行时依赖。
- 部署执行发生在 CI / controlled runner / operator machine，不由 Worker Cron 在 Worker
  runtime 内执行 wrangler deploy。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- current plan: `./phases/phase-1-manifest-check-and-release-ledger/PLAN.md`

## External Basis

- Cloudflare Workers Cron Triggers 使用 UTC cron 表达式：
  <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Cloudflare Workers Static Assets 与 Worker deploy 属于同一发布交付面：
  <https://developers.cloudflare.com/workers/static-assets/>
- Cloudflare Workers Builds Deploy Hooks 可作为后续即时 nudger，但 payload 不能替代 manifest
  校验：
  <https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/>

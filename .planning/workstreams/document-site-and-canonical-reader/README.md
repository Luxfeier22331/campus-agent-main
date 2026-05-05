---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-05-05
---

# Workstream: Document Site And Canonical Reader

这是 `document-site-and-canonical-reader` 的 native workstream 入口。
它负责文档站、published reader assets、`app-api` docs control-plane seam 与 canonical reader model 的前向收口。

## Current Status

- status: `completed`
- completed phase: `Phase 7`
- completed on: 2026-05-05
- active implementation: none
- completion posture: `public-docs` browser surface、published reader assets、`app-api`
  docs control-plane、restricted / historical reader handoff、chat source item
  projection 与 notice jump browser contract 已收口；Phase 7 已把 docs-only chat source
  cards 升级为类型化来源列表；2026-05-05 closeout 的 app-api / public-chat 定向验证、
  app-api typecheck 与 docs lint 已通过，当前 repo-wide web lint / staging chat E2E
  阻塞归属其他 active worktree / 部署态入口依赖。
- follow-up owner: 后续真实 public-chat source-item 产品入口漂移验证，归对应
  public-chat 产品入口验收线承接；notice source serving 正式进入 public chat 后再补
  端到端来源跳转验收。
- reopen rule: 只有在 docs control-plane / published reader asset contract 漂移、
  gated reader delivery 失效、chat `source_items` 重新暴露 raw retrieval / private
  notice locator、source jump 在真实 public-chat 入口失败，或 notice source serving
  正式打开且需要补充端到端来源跳转验收时恢复。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap ledger: `./GAP-LEDGER.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/document-site-and-canonical-reader.md`

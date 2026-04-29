---
doc_type: context
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Context: Phase 1 Manifest Check Contract And Release Ledger

## Problem

`apps/public-docs` 的内容来自 deploy-time sync 的 published reader assets。
ingestion 侧会持续产出新的 canonical reader assets，并维护 public docs publish manifest。

如果没有 manifest check + release ledger，文档站更新只能靠人工部署，无法稳定回答：

- 当前 manifest 是否已经部署
- 本次检查为什么跳过
- 本次 candidate manifest 是否有效
- 哪次部署对应哪个 manifest digest
- 失败时是否污染 last deployed release
- 如何证明 public static bundle 没有混入 restricted content

## Accepted Direction

- prod 每天北京时间 `00:00 / 06:00 / 12:00 / 18:00` 检查 manifest。
- controlled runner scheduled expression 采用 UTC `7 4,10,16,22 * * *`。
- manifest 变化时才执行 build/smoke/deploy。
- manifest 无变化时 ledger 记录 skipped，不触发 deploy。
- deploy job 不扫描对象存储决定公开子集。
- Worker runtime 不执行 wrangler deploy。

## Existing Repo Hooks

`apps/public-docs/package.json` 已有可复用脚本：

- `build:published-reader-assets`
- `deploy`
- `deploy:staging`
- `sync:published-reader-docs`
- `sync:published-reader-assets`

相关稳定文档：

- `docs/architecture/system/document-site-architecture.md`
- `docs/contracts/document-reader-publish-contract.md`

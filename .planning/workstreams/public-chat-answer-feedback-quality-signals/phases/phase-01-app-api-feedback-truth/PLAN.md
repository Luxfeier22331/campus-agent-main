---
doc_type: phase_plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: App API Feedback Truth

Status: completed on 2026-04-29. Summary is recorded in `SUMMARY.md`.

## Goal

在 `apps/app-api` 内建立 answer feedback 的 schema、service 与 browser-surface route。

## Tasks

1. 新增 shared-product migration，创建 `chat.message_feedback` 或 Phase 0 冻结的等价表。
2. 更新 Drizzle schema export 与 bootstrap/test schema inventory。
3. 实现 feedback command service：
   - resolve principal
   - validate chat access
   - validate conversation ownership
   - validate message belongs to conversation
   - validate message role is `assistant`
   - validate optional `request_id` correlation if present
   - upsert latest feedback by owner principal + message
4. 实现 app route，并返回 typed feedback state。
5. 更新 `APP_API_ROUTE_EXPOSURE_INVENTORY`。
6. 更新 `docs/contracts/app-api-http.md` 与 `docs/data/app-api-schema.md`。
7. 增加 route/service/store tests。

## Data Rules

- feedback table 不复制 raw prompt、raw answer、provider response、retrieval payload。
- required correlation fields：owner principal id、conversation id、message id、request id nullable、
  vote、reason codes、created/updated timestamp。
- optional comment 必须长度限制并按用户提供文本处理。

## Exit Criteria

- app-api route 在 authenticated session 下可用。
- cross-user、non-assistant、missing message、invalid reason 都 fail closed。
- route exposure inventory 与 docs 同步。

## Verification

- `pnpm --dir apps/app-api test`
- targeted app-api route/service/store tests

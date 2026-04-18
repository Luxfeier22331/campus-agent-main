---
phase: "D"
name: "Integrated Acceptance"
created: 2026-04-19
status: active
---

# Phase D Context

## Goal

验证 public chat 与 protected panel 通过 shared `app-api` 连成同一条产品链路。

## Current Truth

- local Phase A-C baseline 已 fresh 通过
- 下一步固定为 browser smoke 与 integrated acceptance
- `protected-panel-runtime-api-inventory.md` 现为本 workstream 的本地实施参考

## Guardrails

- 同一 workstream 内不拆 `app-api`、chat、panel 并发 lane
- 若根因落在 shared seam，修复必须回到 `apps/app-api`
- `Jobs`、`Operations`、`Audit` 仍不属于当前验收范围

## Entry

- `docs/plans/shared-product-surfaces-acceptance-hardening.md`

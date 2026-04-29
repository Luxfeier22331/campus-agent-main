---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

# Plan: Phase 1 Manifest Check Contract And Release Ledger

## Goal

落地 rolling publish 的第一层执行边界：manifest check contract、release ledger schema、
dry-run 输出、状态机与 validation gates。Phase 1 不执行真实 deploy。

## Requirements

- 读取 ingestion-maintained current manifest pointer。
- 计算并持久化 manifest digest。
- 与最后一次 successful deployed digest 比较。
- 支持 dry-run 输出 `changed / unchanged / invalid / blocked`。
- 定义 deploy release ledger schema 与状态转换。
- 定义 manifest validation gates。
- 不扫描对象存储推断公开子集。
- 不改变 `apps/public-docs` reader shell 或文档 UI。

## Implementation Tasks

1. Inventory existing manifest inputs.
   - 确认当前 `sync:published-reader-docs` 从哪里读取 public docs sync manifest。
   - 明确 current pointer、immutable manifest object、manifest digest 的 repo-level 名称。
   - 如果当前只有脚本内隐式输入，补成显式 config contract。

2. Add manifest check CLI.
   - 建议入口：`apps/public-docs/scripts/check-published-reader-manifest.ts`。
   - 支持 `--env staging|prod`、`--dry-run`、`--ledger <path>`。
   - 输出机器可读 JSON，不只打印 prose。
   - 不执行 build 或 deploy。

3. Add release ledger model.
   - 建议 ledger 存储优先使用 CI/runner 可持久化对象；本地开发使用 gitignored
     `.planning/runtime/public-docs-publish/` 或 `.tmp/`。
   - schema 包含 candidate release、manifest digest、previous deployed release、状态、
     failure reason、timestamps、runner id 与 Cloudflare deployment id 预留字段。

4. Add validation gates.
   - manifest schema valid。
   - source object keys present。
   - asset-manifest hash / size matched。
   - target paths unique。
   - `gated_asset` / `withheld` entries not included in public static bundle plan。
   - output includes deterministic diff summary。

5. Add tests.
   - unchanged manifest -> `skipped` candidate。
   - changed manifest -> `changed` candidate。
   - invalid schema -> `invalid` and no deployed pointer advance。
   - restricted entry in public plan -> `blocked`。
   - ledger transition rejects `deployed` without validation success.

6. Update docs.
   - Link new contract from this workstream state.
   - If implementation changes document-site publish contract, update
     `docs/contracts/document-reader-publish-contract.md`.
   - If only runner mechanics are added, keep architecture docs unchanged and
     document the runner behavior in the workstream or runbook.

## Verification

Run targeted checks after implementation:

```bash
pnpm --filter public-docs test
pnpm --filter public-docs typecheck
pnpm web:lint
```

If Phase 1 touches repo-level Python harness or docs lint, also run:

```bash
pnpm docs:lint
pnpm yaml:lint
```

## Done Criteria

- Phase 1 CLI can produce dry-run evidence for unchanged and changed manifest fixtures.
- Ledger schema rejects illegal state transitions.
- Restricted/gated content cannot be admitted into public static plan.
- No real deploy occurs in Phase 1.
- `STATE.md` points to latest dry-run evidence.

## Out Of Scope

- Scheduled execution.
- Cloudflare deploy.
- Preview smoke.
- Rollback.
- Webhook/deploy-hook integration.

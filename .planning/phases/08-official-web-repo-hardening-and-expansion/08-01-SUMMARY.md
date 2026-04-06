---
phase: 08-official-web-repo-hardening-and-expansion
plan: "01"
status: completed
completed_at: "2026-04-02T12:27:54+08:00"
---

# 08-01 Summary

## Outcome

`official_web` 的 thin roster / dense direct roster family truth 已在当前 worktree 收口为一致 repo truth：

- 新增 dense direct roster regression fixture 与测试，先红后绿
- collector source-truth classification 新增 `dense_short_link_directory_signal`
- `law.muc.edu.cn/szdw1.htm` 在 fresh `r5` live batch 中已从旧的 `listing_page` 修正为 validated `directory_page`
- repo 参考文档已同步到最新 `r5` evidence，不再保留旧叙述

## Files

- `apps/official-web-collector/src/page-artifacts.ts`
- `packages/official-web-core/src/source-truth.ts`
- `apps/official-web-collector/test/page-artifacts.test.ts`
- `apps/official-web-collector/test/test-support.ts`
- `apps/official-web-collector/test/fixtures/pages/sample-law-dense-roster-directory-page.html`
- `docs/reference/official-web-muc-public-batch-a-law-history-audit-20260402.md`

## Verification

- `pnpm --dir apps/official-web-collector exec vitest run test/page-artifacts.test.ts -t "dense direct roster pages"`: pass
- `pnpm --dir apps/official-web-collector test`: pass
- `pnpm --dir apps/official-web-collector typecheck`: pass
- `pnpm --dir apps/official-web-collector crawl -- --site-id muc_public --crawl-run-id qc-20260402-batch-a-law-history-r5 --host law.muc.edu.cn --host history.muc.edu.cn --max-pages-per-host 10 --max-total-pages 20 --output-dir /tmp/official-web-qc-batch-a-law-history-r5`: pass
- `pnpm --dir apps/official-web-collector validate -- --output-dir /tmp/official-web-qc-batch-a-law-history-r5 --json`: `valid=true`, `errors=0`, `warnings=0`
- `pnpm --dir apps/official-web-collector qc-report -- --output-dir /tmp/official-web-qc-batch-a-law-history-r5 --json`: `passPages=20`, `reviewPages=0`, `failPages=0`
- `uv run --all-packages python -m campus_ingestion_worker.project_official_web_source_truth --output-dir /tmp/official-web-qc-batch-a-law-history-r5 --projection-output-dir /tmp/official-web-qc-batch-a-law-history-r5-projection`: `pages_seen=20`, `emitted_documents=20`, `manual_review_pages=0`
- `uv run --all-packages python -m campus_ingestion_worker.validate_official_web_projection --projection-output-dir /tmp/official-web-qc-batch-a-law-history-r5-projection`: `valid=true`, `errors=0`, `warnings=0`

## Fresh Truth Locked

- `https://law.muc.edu.cn/szdw1.htm`: `directory_page`, `pageFamilyReason=dense_short_link_directory_signal`
- `https://history.muc.edu.cn/`: `listing_page`, `pageFamilyReason=mixed_card_date_link_listing_signal`
- `r5` family counts: `article_detail=7`, `listing_page=7`, `directory_page=6`

## Next

执行 `08-02`：把 stable regression gate、low-budget expansion batch、projection replay/import checklist 固化为 repo-level workflow。

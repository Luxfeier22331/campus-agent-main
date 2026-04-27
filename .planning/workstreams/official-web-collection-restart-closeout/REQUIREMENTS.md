---
doc_type: requirements
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Requirements: Official Web Collection Restart Closeout

## Goal

恢复并记录 official web 本地采集路径的可重复闭环：从 `official_web` source channel 发现候选内容，写入
`fresh_news` collection，并保留可追溯的 batch report、DB inspection 与局部验证证据。

## Scope

- 本地 dry-run 与真实 batch 验证。
- `fresh_news` collection 写入结果 inspection。
- batch report 路径、run id、验证命令和当前缺口落盘。
- 后续 scheduler、preflight、retention、alert 与重复运行验收的 workstream 状态记录。

## Non-Goals

- 不开放 `fresh_news` 或 `news_archive` query-serving surface。
- 不改变 official web backlog opening 的 reopen rule。
- 不改写 official web control-plane owner。
- 不把本地 batch 成功写成线上部署完成。
- 不处理 authenticated notice、wechat official account 或 campus services runtime routing。

## Success Criteria

- dry-run 能发现 bounded official web candidates，且不会写入 collection。
- 真实 batch 能完成 bounded 写入，report 中 `errors = 0`。
- DB inspection 能看到 `fresh_news` 中新增/当前 archived 文档。
- 局部 official web batch unittest、ruff check、ruff format check 通过。
- 剩余 scheduler / preflight / retention / alert / repeated-run 缺口明确记录在 `STATE.md` 与
  `ROADMAP.md`。

## Acceptance Evidence

Latest accepted local evidence:

- dry-run command:
  `uv run --all-packages python scripts/run_ingestion_worker_batch.py --source-channel official_web --limit 5 --report-dir .tmp/official-web-restart-smoke --dry-run`
- real batch command:
  `uv run --all-packages python scripts/run_ingestion_worker_batch.py --source-channel official_web --limit 5 --report-dir .tmp/official-web-restart-batch`
- DB inspection command:
  `uv run --all-packages python scripts/inspect_ingestion_db.py --collection fresh_news --limit 10`
- local verification:
  `uv run --all-packages python -m unittest tests.ingestion_core.test_official_web_batch`
- lint:
  `uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core scripts tests/ingestion_core`
- format check:
  `uv run --all-packages ruff format apps/ingestion-worker packages/ingestion-core scripts tests/ingestion_core --check`

Latest accepted local outcome:

- candidates discovered: `5`
- committed: `5`
- skipped: `0`
- errors: `0`
- run id: `e0ed85dd-81fc-4882-b122-dae0246ac524`
- report: `.tmp/official-web-restart-batch/official_web_batch_e0ed85dd-81fc-4882-b122-dae0246ac524.json`

---
doc_type: index
truth_scope: repository
owner_boundary: docs/reference/archive/authenticated-notice
status: active
created: 2026-04-20
updated: 2026-04-20
---
# Authenticated Notice Historical Archive

## Archive Status

本文聚合 `authenticated-notice` 领域已经退出默认阅读路径的历史资料。
这些文档和摘要继续保留追溯价值，但不再各自占据 domain hub 与
`reference/README.md` 的主入口。

当前 canonical 入口已经收回到：

- `docs/domains/authenticated-notice.md`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/runbooks/authenticated-notice-async-staged-closeout-runbook.md`
- `docs/reference/archive/python-ingestion-worker/internal-notice-offline-preparation-strategy.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`

## Archived Plans

- `git history authenticated-notice source foundation plan`
  - source-channel foundation closeout baseline
- `git history authenticated-notice historical backfill closeout plan`
  - legacy cumulative-prefix closeout baseline
- `git history local live eval registry recovery plan`
  - 一次 repo-local recovery / closeout 叙事

## Archived Runbook Summary

- historical donor intake 旧路径曾描述 donor bundle 的 family analysis、
  selection freeze、normalization 与 local smoke。
- legacy cumulative-prefix closeout 旧路径曾描述 historical export bundle 的
  closeout 命令、输出物与旧验收口径。
- bounded replay pilot 旧路径曾描述如何从 frozen inventory 选出小批量 pilot
  notice 并停在 `verified`。

## Archived Evidence

- `docs/reference/archive/authenticated-notice/authenticated-notice-portal-live-observations.md`
  - `2026-04-09` live portal 登录态观察快照
- `docs/reference/archive/authenticated-notice/authenticated-notice-historical-closeout-evidence.md`
  - historical closeout 完成态证据
- `docs/reference/archive/authenticated-notice/authenticated-notice-historical-donor-intake-evidence.md`
  - historical donor intake acceptance 快照
- `docs/reference/archive/authenticated-notice/restricted-document-center-artifact-contract.md`
  - restricted document center 旧设想与 artifact 分层历史

Deleted stub summary:

- `internal_notice` 离线 preparation / release 曾在 `2026-04-06` 到
  `2026-04-11` 之间从 early failure 走到 replay / preparation / promote /
  unpublished release；旧正文只通过 git history 追溯。

## Historical Throughline

- `authenticated_notice_portal` 先完成 donor absorption 与 historical closeout
- 之后 source-truth replay、async staged closeout 与 regulation downstream consumption 才逐步成为 canonical operator path
- 因此这些历史材料继续保留“当时如何迁移、为何这样收口”的解释价值，但不再承担当前 operator 入口

## Usage Rule

- 需要当前真相时，不要从这些 historical 文档反推当前执行路径
- 需要追溯旧 runbook 正文或已删除 path-stub 时，通过 git history 追溯

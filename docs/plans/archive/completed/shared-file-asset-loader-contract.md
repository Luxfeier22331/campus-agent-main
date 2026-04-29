---
doc_type: plan
status: completed
created: 2026-04-19
updated: 2026-04-20
---

# Shared File Asset Loader Contract And Migration

## Completion Note

这条 shared file asset loader workstream 已关闭。
它完成的是 repo 级文件型资产处理 contract、OCR lane-first provider truth、legacy Office conversion runtime，以及 OOXML post-extraction normalization 的前向收口。

## What This Plan Closed

- 固定 shared loader / normalization / extraction contract
- 收口 OCR provider truth，不再保留 provider-first 叙述漂移
- 收口 `JODConverter + LibreOffice` self-hosted conversion service 与 worker consumption seam
- 补齐 OOXML structured normalization 与 real-sample verification

## Current Canonical Entry

- `docs/architecture/current-architecture.md`
- `docs/environment/README.md`
- `docs/runbooks/legacy-office-conversion-runtime.md`
- `docs/plans/README.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 repo 重新 admission 新的文件资产 family、修改 shared conversion / normalization contract，或扩大 cross-scope adoption 时，才应新开 follow-up lane。

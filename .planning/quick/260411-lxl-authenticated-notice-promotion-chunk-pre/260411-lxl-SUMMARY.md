# Quick Task 260411-lxl Summary

## Outcome

- 已完成一轮 GSD-style research closeout，结合 repo 当前 truth 与官方资料，冻结了 authenticated-notice promotion v5 之后的下一安全执行切片。
- 当前唯一允许进入下一步 pilot 的长期规章候选仍是 `187233`。
- `hold` 与 `manual_review_required` 已明确分流，不应再回混到当前 regulation candidate baseline。

## Frozen Decision

下一步只做：

- `187233` 的 local-only single-document chunk-prep pilot

下一步不做：

- 16 条样本的批量 chunk-prep
- cross-collection promotion write
- Postgres / Qdrant / embedding / release / alias side effects
- OCR 主链路从 async jobs 切回同步 service

## Current Buckets

### Promote Next Pilot

- `187233`

### Hold In `internal_notice`

- `177880`
- `351119`
- `351699`
- `351704`
- `355282`

### Keep As `manual_review_required`

- `191176`
- `191177`
- `191705`
- `186957`
- `186977`
- `187004`
- `196411`
- `351907`
- `353963`
- `354006`

## Why This Slice

- `187233` 的正文已经具备独立制度文本的基本结构，适合先验证 `notice_body` lane 的 structure-first chunking。
- 它仍缺 `source_notice_release_time` 等 promotion metadata，因此现在只能进入 local pilot，不能直接写 regulation collection。
- manual 样本已经被清晰证明属于“季节性/暂行运营规则”或“年度/项目制招生细则”，不属于当前长期规章 collection。

## Artifacts

- `260411-lxl-RESEARCH.md`
- `manual-review-taxonomy.json`
- `260411-lxl-PLAN.md`
- `260411-lxl-VERIFICATION.md`

## Local-Only Boundary

- 本 quick task 没有执行 Postgres 写入。
- 没有执行 Qdrant / embedding / alias / release。
- 没有触发 live portal 采集。
- 没有改变 repo 当前 async OCR 默认主链路。

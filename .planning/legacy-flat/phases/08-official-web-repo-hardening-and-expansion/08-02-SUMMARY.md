---
phase: 08-official-web-repo-hardening-and-expansion
plan: "02"
status: completed
completed_at: "2026-04-02T12:42:27+08:00"
---

# 08-02 Summary

## Outcome

Phase 8 的 repo-level `official_web` workflow 已收口为一条明确双轨流程：

- stable regression gate
- low-budget expansion batch

同时明确把 scheduler / hot lane promotion 从这两条执行面中剥离出来，不再混淆：

- host 已 allowlisted
- host 已通过一次 expansion batch
- host 已进入 scheduler / hot lane

## Files

- `configs/sources/official_web/muc_public/README.md`
- `docs/runbooks/official-web-collector-smoke-and-audit.md`
- `docs/runbooks/official-web-source-truth-projection-replay.md`

## Verification

- `rg -n 'regression gate|expansion batch|stable gate|low-budget|scheduler|hot lane|projection replay|validator' docs/runbooks/official-web-collector-smoke-and-audit.md docs/runbooks/official-web-source-truth-projection-replay.md`: pass
- `rg -n 'projection-declarations|page families|regression|expansion|batch' configs/sources/official_web/muc_public/README.md`: pass

## Locked Repo Truth

- `official_web` 默认先跑 stable regression gate，而不是直接扩 host
- stable gate 外的新 host 默认先走 low-budget expansion batch
- expansion batch 必须跑完 `validator -> qc-report -> projection replay -> projection validator`
- expansion batch 通过后必须补 repo reference note
- expansion batch 通过不自动修改 `scheduler-policy.json`，也不自动进入 `hot lane`
- 如需继续验证 import / handoff，再回到 smoke runbook 的 control-plane seam 步骤继续执行

## Phase Closeout

Phase 8 现已完成：

- `08-01` 收口 dense roster / listing family truth
- `08-02` 收口 repo-level expansion workflow

## Next

后续如果继续做 `official_web`，优先级应是：

- 修 `history.muc.edu.cn` listing projection 的重复项与日期噪声
- 继续按 low-budget expansion batch 逐个验证已 allowlisted host
- 如果未来要讨论 scheduler / hot lane promotion，必须单独补 freshness / priority 证据

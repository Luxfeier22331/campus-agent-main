# Quick Task 260414-ang Verification

## Commands

1. `jq '.summary' .planning/quick/260414-ang-regulation-corpus-inventory-blocked-fron/regulation-offline-inventory.json`
2. `jq -r '.entries[] | [.notice_id, .status, .title] | @tsv' .planning/quick/260414-ang-regulation-corpus-inventory-blocked-fron/regulation-offline-inventory.json`

## Expected Outcome

- command 1 能输出当前 inventory summary
- command 2 能输出全部 `16` 条 notice family 的状态与标题

## Result

- command 1：`accepted_current_target_count=11`、`duplicate_hold_source_count=1`、`auth_blocked_count=1`、`handbook_follow_up_count=2`、`isolated_accepted_sample_count=0`、`wrapper_follow_up_count=1`
- command 2：已输出全部 `16` 条 notice family 的 `notice_id / status / title`，其中 `355282` 当前状态为 `accepted_current_target`

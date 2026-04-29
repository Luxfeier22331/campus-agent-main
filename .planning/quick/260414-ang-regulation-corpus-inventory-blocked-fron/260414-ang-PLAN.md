# Quick Task 260414-ang Plan

**Description:** 冻结已采集 regulation corpus 的离线 inventory 与 blocked frontier  
**Mode:** quick-full

## Scope

- 只处理当前已采集 regulation corpus 的离线状态清单
- 只写：
  - machine-readable inventory JSON
  - reference doc
  - planning truth
- 不处理：
  - 新采集
  - OCR
  - chunk rerun
  - materialization rerun
  - embedding / Qdrant / release / alias

## Success Criteria

1. repo 有一份稳定列出当前 `16` 条已采集 notice family 状态的 inventory。
2. repo 明确区分：
   - `11` 条 formal local current target
   - `355282` attachment-backed `accepted_current_target`
   - `191177` duplicate hold
   - `351119` auth-blocked frontier
   - `351699 / 351704 / 177880` 非当前 regulation target
3. docs / STATE 能直接回链这份 inventory。

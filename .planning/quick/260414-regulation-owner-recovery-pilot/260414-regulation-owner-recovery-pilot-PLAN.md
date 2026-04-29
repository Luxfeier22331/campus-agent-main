# Quick Task 260414-regulation-owner-recovery-pilot Plan

**Description:** 用现有本地 bundle/source bytes 做 regulation owner-body recovery pilot，验证 `355282` 是否可离线恢复，确认 `351119` 的真实 blocker  
**Mode:** quick-full-research

## Scope

- 只处理 `355282` 与 `351119`
- 只在隔离输出目录运行 import -> source projection -> promotion manifest
- 不写正式 current scope

## Success Criteria

1. `355282` 能在隔离环境中从 attachment bytes 恢复出 child document，并重新进入 promotion candidate。
2. `351119` 能被明确证明仍缺 file-release source input，而不是 promotion 逻辑本身有误。
3. quick-task 产出可复跑 summary，给下一轮 current-scope targeted recovery 提供依据。

## Non-Goals

- no current-scope materialization
- no chunk prep
- no embedding / Qdrant
- no release / alias publish

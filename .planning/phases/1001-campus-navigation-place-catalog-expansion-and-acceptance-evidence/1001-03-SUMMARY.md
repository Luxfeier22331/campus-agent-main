# 1001-03 Summary: place-finding acceptance contract deferred behind map-launch backlog

## Outcome

`1001-03` 已关闭，但关闭方式是显式 deferred，而不是伪造 staging/manual acceptance 完成。

当前 repo 真相已经明确：

- 校内导航产品路径暂不支持
- `place_lookup` 继续 fail-close
- `place_card` / map consumption 与 staging/manual acceptance 不再伪装成当前 rollout 内任务
- 后续真实验收统一等待地图产品上线后，从 backlog `999.2` 恢复

## Key Changes

- `.planning/STATE.md`
  - 当前执行面已固定“导航产品路径暂停、`place_card` / map consumption 延后到地图上线后再恢复”
- `.planning/PROJECT.md`
  - 当前 active truth 不再把导航 acceptance 写成主链路待执行项
- `.planning/ROADMAP.md`
  - `1001-03` 已改为显式 deferred closeout，并与 backlog `999.2` 绑定

## Verification

- planning truth review against `.planning/PROJECT.md`
- planning truth review against `.planning/STATE.md`
- roadmap/backlog consistency review against `.planning/ROADMAP.md`

结果：

- 当前分支不再把 map 未上线条件下的 acceptance 欠账误写成 active implementation blocker

## Remaining Gap

- 真正的 staging/manual acceptance 仍未执行
- `place_card` / map consumption 仍未恢复
- 恢复条件不是“继续补最小 smoke”，而是地图产品实际上线

## Next

- 地图上线后，从 backlog `999.2` promote 回 active roadmap
- 重新执行 `1001-03` 的 query inventory、artifact checklist 与真实 staging/manual closeout

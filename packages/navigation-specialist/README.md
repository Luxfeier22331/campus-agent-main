# campus-navigation-specialist

校园地点寻找 specialist。

当前首发 slice 只覆盖 `place_lookup` / `place_finding`：

- repo-owned `place_catalog` seed
- institution-scoped alias resolution
- `completed` / `needs_clarification` / `no_answer` / `error`
- 文本答案与结构化 `place_card`

## Terminology Posture

- 当前 accepted package / runtime / contract truth 继续使用 `navigation-specialist`
- target-side architecture / planning 文档可以使用 `navigation-agent` 作为 forward family label
- 在 repo-wide convergence phase 真正迁移前，这个 package 目录与 current-truth label 不变

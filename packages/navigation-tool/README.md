# campus-navigation-tool

校园地点寻找 tool runtime。

当前首发 slice 只覆盖 `place_lookup` / `place_finding`：

- repo-owned `place_catalog` seed
- institution-scoped alias resolution
- `completed` / `needs_clarification` / `no_answer` / `error`
- 文本答案与结构化 `place_card`

## Terminology Posture

- 当前 active package 使用 `tool` 命名；`ToolRequest` /
  `ToolResponse` 只作为 legacy-named execution handoff DTO 保留。
- `place_lookup` 是具体 tool target / projection label；`navigation` 只保留为领域 /
  package label，不作为对外 tool identity。

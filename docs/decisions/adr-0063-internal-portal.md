---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0063
status: accepted
---
# ADR-0063 Internal Portal 来源名称

## 背景

旧 source-channel 名称 `authenticated_notice_portal` 混合了认证方式和一个 source surface，
而同一门户现在同时提供 notice 和 file release。

## 决策

权威 source channel 名称是 `internal_portal`。

- `notice` 和 `file_release` 是 source surface，不是 source channel。
- active task id 使用 `internal_portal.notice.*` 或
  `internal_portal.file_release.*`。
- active source record 和 object key 使用 `source_channel=internal_portal`。
- 不为 `authenticated_notice_portal` 提供 runtime alias；旧 artifact 必须显式迁移后才能
  replay。

仍含 `authenticated_notice` 的 schema 名称只表示 artifact family，不恢复旧 source-channel
value。

本决策只修订 ADR-0024 选择的名称，不替代 ADR-0024 的 source-channel 边界。

## 后果

- code、config 和当前文档不得把旧 value 当作已接受 source channel。
- provider-specific authentication 属于 adapter，不进入 source-channel 名称。
- 新 portal surface 可以复用 `internal_portal`，无需再次改 channel 名称。

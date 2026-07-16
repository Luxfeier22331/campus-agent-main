---
doc_type: data
owner_boundary: domains/transport
status: active
---

# 班车运维数据

## 边界

`campus_services_ops` 只保存班车来源确认、临时变更、已发布变更集和运维审计。
它不保存通用服务目录、办事指南、原始通知/聊天/截图/文件、tool schema 或学生状态投影。

班车领域行为见 `../domains/transport.md`。

## 链路

```text
运维人员安全确认
-> 有界班车临时变更
-> 预览
-> 已发布版本
-> execution-control 班车读取模型
```

该 schema 只保存人工确认的临时变更，不重建基准时刻表，也不扩张成通用校园服务内容库。

## 表

### `source_attestations`

保存来源类型、摘要、运维备注、确认时间、状态和创建者。摘要不得包含原始聊天、截图、OCR、
附件 bytes 或对象存储位置；长期证据由来源所有者保存。

### `transport_overrides`

保存 route identity、展示名、service status、message、有效窗口、来源确认 ID、review state 和
审计字段。

- 每条变更必须有有限有效窗口；
- 结束时间必须晚于开始时间；
- route ID 必须属于结构化班车数据；
- 只有当前有效且 `ready_for_publish` 的变更进入预览和发布。

### `releases`

保存 published current-effective overlay snapshot、条目数、备注和发布者。release 与 audit
必须原子写入。没有 published release 表示当前 overlay 无法证明，不等同于“没有临时变更”。

### `audit_events`

保存 action、object identity、受控 before/after 摘要、actor 和时间。不得保存原始证据、object
key、provider payload 或 sink 原始事件。

## Runtime 边界

execution-control 只消费最新 published release。无法证明 currentness、route identity、来源或
有效窗口时必须失败关闭。该 schema 不是 RAG collection，也不是 model-visible tool 通过 app-api
回环查询的接口。

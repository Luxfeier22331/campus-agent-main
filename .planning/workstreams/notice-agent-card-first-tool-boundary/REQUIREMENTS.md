---
doc_type: requirements
workstream: notice-agent-card-first-tool-boundary
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Notice Agent Card-First Tool Boundary

## Problem

当前 notice runtime 同时承载了 source-truth body access、agent tool execution 与用户侧
answer rendering。`campus_notice_get` 在 Python notice-agent 与 Go direct runtime 中都可能把
`normalized_body` 直接输出给用户。这与通知产品面应默认引导用户回官方页面的目标不一致，也让
provider/SDK loop 更容易把“按 ID 取正文”当成可自由选择的 agent-facing tool。

## Goals

1. 把 notice 用户面重切为 card-first / source-link-first。
2. 保留 source-truth body、OCR、图片与附件采集能力，但明确它们只属于内部 evidence /
   materialization plane。
3. 保留 `campus_notice_discover` 作为 agent-facing tool。
4. 将 selected notice card/context/body/media 读取下沉为 deterministic query functions。
5. 修正 `campus_notice_get` 的 contract / ToolSpec / runtime posture，避免正文输出回流。
6. 增加 eval 和 guardrail，证明 public answer 不输出完整通知正文。

## Non-Goals

- 不删除 authenticated notice source-truth、OCR、多模态或附件采集链路。
- 不打开新的 notice serving surface。
- 不把 notice 正文迁到 public reader。
- 不改变 regulation、schedule、service-status 等下游 materialization 的 owner。
- 不把 SDK 提升为 notice routing owner。

## Success Criteria

- 用户找通知时返回 `NoticeCardSet` / official URL，而不是正文。
- 用户要原文时返回 official URL，而不是复制正文。
- 用户要总结或抽取事实时，内部可读取 bounded context，但最终只输出短摘要或事实，且附官方链接。
- `normalized_body`、OCR owner text、inline image text 与附件正文不能直接进入 public
  `answer_text`、workflow trace canonical asset、panel canonical asset 或 eval canonical asset。
- `campus_notice_get` 不再作为 provider/SDK default pilot 的 body-serving tool。
- `ToolSpec` 能区分 agent-facing tool 与 internal query function。
- Go finalizer / direct structured answer path 有 full-body-forbidden guard。
- Eval 覆盖 discover、resolve/link、summary、fact extraction、current-fact reroute 与 body leak。

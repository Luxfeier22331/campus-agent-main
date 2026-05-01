---
doc_type: index
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Notice Agent Card-First Tool Boundary

本 workstream 负责把 notice-agent / notice tool 从“正文读取工具”重切为
source-link / card-first 的通知能力边界。

核心结论：

- 用户可见 notice surface 默认只展示 title、official URL、source family、发布时间、
  短摘要或匹配原因。
- canonical body、OCR owner text、inline image text 与附件正文仍应采集和存储，但只作为
  source-truth、内部 context、下游 materialization、bounded summary 或 fact extraction 输入。
- `campus_notice_discover` 保留为 agent-facing tool，因为它表达“找通知”的用户意图。
- selected notice card/context/body/media 读取应下沉为 notice-agent 或 Go internal query
  service 的 deterministic query functions，不应默认作为 agent-facing ToolSpec 顶层 tool。
- `campus_notice_get` 的现有 body-serving 语义需要重构、改名或降级，不能继续作为
  provider/SDK 可自由调用的正文输出工具。

## Current Status

- status: `active`
- current phase: `Phase 0 ready`
- current slice: freeze notice tool/function boundary before implementation

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Source Of Truth Inputs

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/contracts/campus-notice-runtime-contract.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `configs/runtime/tools.v1.json`

## External Design Inputs

- GOV.UK link guidance:
  `https://www.gov.uk/guidance/content-design/links`
- Google Search snippet guidance:
  `https://developers.google.com/search/docs/appearance/snippet`
- 国家版权局 / 网信办网络转载说明:
  `https://www.cac.gov.cn/2015-04/23/c_1115089018.htm`

---
doc_type: requirements
status: backlog
created: 2026-04-29
updated: 2026-04-30
---

# Requirements: Public Web Recent Updates Surface

## Goal

为 public web chat 增加一个可浏览的“最近更新”入口，让用户不通过对话也能查看最近更新的校园信息，并按全部通知、schedule 通知、status 通知与 regulation 通知分面筛选。

## Captured Requirement

public web chat 需要提供一个地方展示最近更新：

- 全部通知
- schedule 通知
- status 通知
- regulation 通知

这应是 browser-facing product surface，不应被实现成 supervisor/chat answer 的一次性生成结果。

## In Scope

- `public-chat-web` 或同级 public web surface 的“最近更新”入口、列表、分面筛选、空态、错误态、加载态与移动端体验
- `apps/app-api` owned updates API，例如候选形态 `GET /api/updates?facet=all|schedule|status|regulation`
- projection-backed updates read model，统一承接 notice-level query cards、transport schedule updates、service status updates 与 admitted regulation updates
- cursor pagination、稳定排序、published/effective 时间、freshness metadata、canonical/source URL 与 source family 暴露策略
- public visibility fail-closed policy，确保 restricted notice、未 admission regulation candidate 与内部 operator-only provenance 不外露
- 与现有 notice / campus-services / regulation projection 的数据边界对齐
- API、UI、projection builder 与 visibility gate 的测试与 smoke

## Non-goals

- 不通过 public chat prompt、supervisor tool 或 agent answer 生成最近更新列表
- 不在 query-time 扫描 source truth bucket、raw notice bundle、原始 HTML、collector export 或对象存储目录
- 不让 `public-chat-web` 直接读取数据库、对象存储或 packages 内部数据结构
- 不把 regulation candidate、未 promotion 的 notice-derived regulation 或质量门未通过内容展示给 public 用户
- 不把 restricted authenticated notices 直接暴露给 public anonymous surface
- 不重开 authenticated-notice retention state machine、collector routing taxonomy 或 downstream admission 规则
- 不把 procurement、讲座、活动等普通 notice 类型提升为 dedicated runtime facet，除非后续产品范围单独 admission

## Success Criteria

1. 用户可以从 public web chat/public web 入口看到最近更新列表，并在 `all / schedule / status / regulation` 分面间切换。
2. 所有列表数据来自 admitted projection / read model，query-time 不依赖 raw source scan。
3. `app-api` 明确拥有 updates API、visibility policy、pagination 与 response contract。
4. public anonymous surface 对 restricted notice、内部 provenance、未 admission regulation candidate 默认 fail-closed。
5. schedule/status/regulation 卡片能表达标题、摘要、发布时间或生效时间、canonical/source URL、facet、source family、target surface 与 visibility posture。
6. UI 具备可验收的 loading、empty、error、pagination/mobile 状态，不把“最近更新”藏在对话生成结果里。
7. 新增 surface 不改写 `supervisor-led multi-agent` query path，也不把 product read surface 下放到 `packages/supervisor-core`。

## Canonical Entry

- `.planning/workstreams/public-web-recent-updates-surface/README.md`

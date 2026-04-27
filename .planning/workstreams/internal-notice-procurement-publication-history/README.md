---
doc_type: index
status: backlog
created: 2026-04-24
updated: 2026-04-28
---

# Workstream: Internal-Notice Procurement Publication History

这是 `internal-notice-procurement-publication-history` 的 native backlog
workstream 入口。
它记录 `campus_notices/internal_notice` 中采购 / 比选 / 招标 / 中选结果类
notice 的轻量历史查询设计：这类 notice 已有 `procurement_notice` family
和 `procurement_notice_history` target surface，后续重点不再是补分类，而是
保证采购历史与低优先级通知都能被正确分流、检索命中，并返回 title + url
给 Web 侧消费。

## Current Status

- status: `backlog`
- reopen rule: 只有在产品范围决定打开 procurement/history notice cards、修复
  notice title/url contract 漂移，或为低优先级 notice 建立 Web 消费卡片验收时恢复
- current posture:
  - `procurement_notice` family 与 `procurement_notice_history` target surface
    已进入 notice consumption layer
  - 采购类不进入 `regulations/*` 或 `campus_services/*`
  - 当前不新增采购生命周期对象，不新增 dedicated procurement tool
  - 最低产品口径是通过 `campus_notice_discover/get` 返回 title + url
    供 Web 侧渲染

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线不重开 `authenticated-notice-regulation-consumption`
- 这条线不替代 `authenticated-notice-live-portal-control-plane`
- 这条线不把 procurement notice 伪装成 `service_status_override`
- 这条线不要求所有采购 notice 进入正文解析、附件 OCR 或 VLM 处理
- 这条线不要求 `stage` 字段或 procurement lifecycle object
- 这条线的默认 consumption surface 是 notice/history card，不是新 runtime tool

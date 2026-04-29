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
notice 的后置专项查询设计。当前首期产品口径已调整：采购类与讲座、活动、
一般公告没有本质区别，暂缓进入专用下游消费；首期只要求它们能被正确分类、
分流、通过通用 PG notice search 命中，并返回 title + url 给 Web 侧消费。

## Current Status

- status: `backlog`
- reopen rule: 只有在产品范围决定把采购类从 generic notice search/card 提升为
  procurement-specific facet/history surface，或发现采购类 title/url card 与通用
  notice search contract 漂移时恢复
- current posture:
  - `procurement_notice` family 与 `procurement_notice_history` target surface
    已进入 notice consumption layer，但首期 product opening 暂缓
  - 采购类不进入 `regulations/*` 或 `campus_services/*`
  - 当前不新增采购生命周期对象，不新增 dedicated procurement tool
  - 最低产品口径是通过通用 PG notice search/read model 返回 title + url
    供 Web 侧渲染；不作为区别于讲座/活动/公告的首期 pilot

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
- 这条线的默认 posture 是 deferred procurement-specific facet，不是首期 runtime
  tool 或 downstream target

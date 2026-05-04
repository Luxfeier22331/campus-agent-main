---
doc_type: roadmap
status: completed
created: 2026-04-28
updated: 2026-05-04
---

# Roadmap: Official Web Collection Restart Closeout

## Overview

这条 workstream 原本收口 official web 采集重启与部署前 ops 缺口。
现在它已经被 one-time source-pack 路线取代，不再继续执行未完成 phase。

## Phases

- [x] **Phase 0: Boundary Confirmation** — 确认本轮目标是恢复 `official_web`
  本地 source-truth projection evidence，不重开 official web news query-serving opening。
- [x] **Phase 1: Local Projection Restart Evidence** — 完成 projection replay 与 validation；
  当前产物为 `85` 个 documents：`75` 个 `muc_public_pages`、`10` 个 `stable_reference`；
  当前 `.env` registry official-web scope 对照为 `0`。
- [x] **Phase 2A: Source Host Split Config** — 补齐 `muc_public` host 分组、
  rollout order 与 stable scheduler `lane_id`；当前形态为校级 lane 先跑，
  院级/topic 通过 disabled single-host lane template 逐个 operator-triggered 验证。
- [x] **Phase 2B: Fresh Rollout Crawl Evidence** — 完成 enabled
  university-core 三 host bounded crawl 与 `law.muc.edu.cn` single-host crawl；
  两批 crawl / validator / QC 均通过；fixed projection replay 的 projection
  validator 与 chunk audit 均通过。当前 evidence 仍是 artifact-only local
  evidence，不代表已 import/promote 或改变 query-serving surface。
- [x] **Superseded Closeout** — 明确 remaining scheduler / preflight / retention / alert /
  deployment work 不再沿旧 collector restart 路线继续实现，forward path 改为
  target-first one-time source-pack capture / replay / release preview。

## Reopen / Close Rule

本 workstream 现在按 superseded historical lane 关闭。

只有在产品明确撤回 one-time source-pack 路线、重新恢复 recurring official-web collector
automation 作为 forward scope owner 时，才应 reopen。

如果产品范围决定正式打开 `fresh_news` 或 `news_archive` query-serving，再恢复 backlog 中的
`official-web-source-channel-news-opening`，不要在本 workstream 内扩展 opening。

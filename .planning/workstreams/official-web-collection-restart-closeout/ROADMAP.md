---
doc_type: roadmap
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Roadmap: Official Web Collection Restart Closeout

## Overview

这条 workstream 只收口 official web 采集重启与部署前 ops 缺口。它不是
`fresh_news` / `news_archive` opening workstream。

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
- [ ] **Phase 2: Dev Scheduler And Preflight Closeout** — 补齐 dev/local scheduler entry、
  worker 专属 preflight 检查项和 repeated-run 操作口径。
- [ ] **Phase 3: Report Retention And Alert Closeout** — 明确 batch report retention、
  failure alert、zero-candidate alert 与 operator handoff 口径。
- [ ] **Phase 4: Deployment Handoff Evidence** — 等待部署窗口时补服务器侧或容器侧 evidence；
  不在当前本地记录中声明线上完成。

## Reopen / Close Rule

本 workstream 可在以下条件满足后关闭：

- dev/local scheduler 与 preflight 路径明确；
- enabled university-core crawl 与至少一个 college single-host crawl 有 fresh evidence；
- fresh evidence 的 chunk audit findings 已修复或被明确 reclassified；
- report retention 与 alert 规则明确；
- repeated-run 验收能证明 projection / handoff batch 可重复执行且不会制造 duplicate side effects；
- 所有证据路径写入 `STATE.md`。

如果产品范围决定正式打开 `fresh_news` 或 `news_archive` query-serving，再恢复 backlog 中的
`official-web-source-channel-news-opening`，不要在本 workstream 内扩展 opening。

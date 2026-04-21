---
doc_type: roadmap
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Roadmap: Document Site And Canonical Reader

## Overview

这条 workstream 负责文档站、published reader assets 与 canonical document reader 的完整前向设计与后续落地顺序。
它不替代现有 retrieval/data-plane truth，也不把 chat 来源展示降级成前端 patch。

## Phases

- [x] **Phase 1: Document Site Architecture And Contract Freeze** — 冻结 `public-docs-web` browser surface、published reader assets posture、`app-api` docs control-plane seams、canonical reader model、source-card jump contract 与 donor posture。
- [ ] **Phase 2: Published Reader Assets And App API Docs Control Plane** — 落 reader projection、published reader assets、docs navigation/search/resolve/version APIs，并确保 visibility/version truth 全部收口在 `app-api`。
- [ ] **Phase 3: Public Docs Web Shell And Information Architecture** — 落 docs landing、collection navigation、reader layout、outline、breadcrumb、version switcher 与 docs-first shell。
- [ ] **Phase 4: Docs Search, Version Navigation, And Static Reader State** — 收口 docs search UX、anchor/highlight state、current/historical version navigation、asset resolve 与 deep-link continuity。
- [ ] **Phase 5: Chat Source Cards And Canonical Jump Integration** — 把 public chat 来源展示改成 canonical source cards，并把 jump target 全部切到 docs reader。
- [ ] **Phase 6: Restricted / Historical Reader Handoff And Acceptance** — 为 restricted collections 与显式 historical reader 收口 admission/deny/gated-delivery continuity，并完成 dev/staging acceptance。

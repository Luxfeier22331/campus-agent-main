---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Architecture

`architecture/` 负责解释产品定位、当前 merged truth、长期目标与 supporting architecture。
它回答“系统是什么”“为什么这样分层”“哪些边界不能退回”。

## 核心入口

- `product-positioning.md`
  - 产品定位、目标用户与产品边界
- `current-architecture.md`
  - 当前 accepted merged-truth snapshot
- `target-architecture.md`
  - 长期目标架构与不可退回的硬约束

## 跨域 supporting architecture

- `product-runtime-architecture.md`
  - public/protected surface、shared `app-api` 与 runtime ownership
- `runtime-delivery-and-release-hardening-architecture.md`
  - staging baseline、release identity、deploy gate 与 post-deploy evidence closure
- `execution-and-specialists-architecture.md`
  - supervisor-led orchestration、specialist boundary 与 prompt assembly seam
- `prompt-and-instruction-architecture.md`
  - prompt hierarchy、trusted/untrusted zoning 与 grounded generation path
- `identity-and-authorization-architecture.md`
  - identity、memory、authz 与 retrieval filter projection 的边界
- `retrieval-serving-architecture.md`
  - query-serving、version mode 与 evidence-oriented retrieval 形态
- `data-plane-architecture.md`
  - source truth、document truth、chunk/index 与 replay/rebuild 分层
- `operator-observability-architecture.md`
  - panel observability domain、read-model family 与 sink participation

## 领域 supporting architecture

### Navigation

- `navigation-and-wayfinding-architecture.md`

### Official Web

- `official-web-architecture.md`
- `official-web-source-truth-contract.md`
- `official-web-freshness-and-incremental-crawling.md`
- `official-web-serving-and-news-retrieval-strategy.md`

### Authenticated Notice

- `authenticated-notice-source-architecture.md`
- `authenticated-notice-source-truth-contract.md`

## 使用规则

- `current-architecture.md` 只写 merged truth，不写 worktree-local 进度
- `target-architecture.md` 只写长期目标，不写当前 phase 顺序
- supporting architecture 负责解释某个边界，不承接一次性 plan 或执行历史

---
doc_type: index
truth_scope: repository
owner_boundary: docs/domains
status: active
created: 2026-04-12
updated: 2026-07-08
---
# Domains

`domains/` 只保留真正有独立 human truth 的窄能力文档。宽领域不再用纯转发 hub
占据默认阅读路径；直接进入对应 architecture、contract、data、runbook 或 reference owner。
跨领域链路图统一见 `../architecture/flows.md`；领域文档只保留自己的 human
capability truth。

## 当前窄能力入口

- `place.md`
  - place catalog、campus-map 读取与未来 navigation 能力边界
- `source-card.md`
  - Q&A source-card、docs reader permalink、anchor 与 highlight 语义
- `transport.md`
  - campus shuttle timetable tool、status projection、source/update/storage
    canonical truth
  - campus-services 当前唯一开放窄能力；runtime 总边界见
    `../architecture/domains/campus-services/architecture.md`

## 直接进入 owner 文档的领域

- authenticated-notice：
  - `../architecture/domains/authenticated-notice/architecture.md`
  - `../data/authenticated-notice.md`
- docs reader：
  - `../architecture/system/document-site.md`
  - `../contracts/app-api/document-reader.md`
- execution：
  - `../architecture/system/execution-agent-layer.md`
  - `../architecture/system/durable-runtime.md`
  - `../contracts/tool-execution.md`
- identity / authz / memory：
  - `../architecture/system/identity-authz.md`
  - `../architecture/system/identity-platform.md`
  - `../architecture/system/memory-plane.md`
- navigation：
  - `../architecture/domains/navigation/architecture.md`
  - `../data/place-catalog.md`
- operator observability：
  - `../architecture/system/ops-observability.md`
  - `../contracts/app-api/observability.md`
  - `../data/app-api/operator.md`
- Q&A：
  - `../architecture/system/execution-agent-layer.md`
  - `../architecture/system/tool-routing.md`
  - `../contracts/app-api/chat.md`
- official-web：
  - `../architecture/domains/official-web/architecture.md`
  - `../contracts/app-api/official-web.md`
  - `../data/official-web.md`
- dining：
  - `../architecture/domains/dining/architecture.md`
  - `../contracts/app-api/dining.md`
  - `../contracts/app-api/dining-ops.md`
  - `../data/dining.md`

## 使用规则

- 宽领域入口只有在能减少跨文档跳转成本且承载独立 owner truth 时才保留；纯转发表直接删除
- 窄能力优先保留一个 canonical human document；只有当 contract、data schema、runbook
  或 architecture 的 owner 边界真实分裂时才拆文档
- `docs/architecture/domains/` 承接 architecture-only supporting truth；`docs/domains/`
  承接领域入口或窄能力 canonical human document
- 长期边界仍以 architecture / decisions / contracts / data owner 文档为准
- 不为计划外扩展提前拆分；一个窄能力文档能讲清楚，就不要拆成多个入口、设计和状态页
- 通用执行态入口固定为：
  - merged truth：`../architecture/current.md`
  - repo 级当前真相：`../../.planning/PROJECT.md`
  - workstream registry：`../../.planning/WORKSTREAMS.md`
  - live session state：GSD SDK / Codex native session
- 领域入口不维护 active/deferred/completed plan 的阅读顺序、带日期的当前状态摘要或
  milestone 级状态。当前真相统一回到
  `current`、`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`
  与 GSD SDK / Codex native session
- 历史材料不挂在默认正文入口；需要追溯旧正文时通过 git history，仍有长期价值的结论再提升到当前 owner 文档

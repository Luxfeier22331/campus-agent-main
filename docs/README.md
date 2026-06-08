---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-04-23
---
# Docs

`docs/` 是 `campus-agent` 的长期文档入口，承载可持续引用的 architecture、ADR、contract、data、
policy、reference、runbook，以及已归档的历史 plan。

## Canonical Entry Points

- [architecture/product-positioning.md](./architecture/product-positioning.md)
  - 产品定位、目标用户与产品边界
- [architecture/current-architecture.md](./architecture/current-architecture.md)
  - 当前 accepted merged truth
- [architecture/target-architecture.md](./architecture/target-architecture.md)
  - 长期目标架构与不可退回约束
- [architecture/system/capability-routing-and-admission-architecture.md](./architecture/system/capability-routing-and-admission-architecture.md)
  - capability routing、surface admission 与 structured/runtime opening owner
- [architecture/system/execution-and-agents-architecture.md](./architecture/system/execution-and-agents-architecture.md)
  - supervisor runtime、agent family、handoff 与 workflow ownership
- [architecture/system/agentic-retrieval-architecture.md](./architecture/system/agentic-retrieval-architecture.md)
  - retrieval-side agentic planning、evidence contract 与 retrieval/runtime split
- [architecture/system/identity-platform-architecture.md](./architecture/system/identity-platform-architecture.md)
  - MUC Wiki Hub Identity Platform、auth runtime adapter 与 account/federation
    product boundary
- [../.planning/PROJECT.md](../.planning/PROJECT.md)
  - 当前项目级 active lane 与 pending work
- [../.planning/WORKSTREAMS.md](../.planning/WORKSTREAMS.md)
  - 当前 active / deferred / backlog workstreams 与 native planning 目录索引

## Documentation Areas

- [architecture/README.md](./architecture/README.md)
  - repo-entry truth 与 supporting architecture 总入口
- [architecture/system/README.md](./architecture/system/README.md)
  - 跨域 supporting architecture
- [architecture/domains/README.md](./architecture/domains/README.md)
  - 领域 supporting architecture
- [decisions/README.md](./decisions/README.md)
  - ADR、接受原因与 supersession lifecycle
- [contracts/README.md](./contracts/README.md)
  - HTTP 与 runtime seam
- [data/README.md](./data/README.md)
  - schema、ownership 与 canonical data boundary
- [reference/README.md](./reference/README.md)
  - 术语、指标、清单与已落盘事实
- [runbooks/README.md](./runbooks/README.md)
  - 可重复执行的操作步骤与验收手册
- [policies/README.md](./policies/README.md)
  - 治理规则、阈值与 collection-specific 约束
- [domains/README.md](./domains/README.md)
  - 跨文档类型的领域导航
- [environment/README.md](./environment/README.md)
  - 环境变量 ownership、配置分层与 provider / secret inventory 入口
- [plans/README.md](./plans/README.md)
  - 已归档 plan 的索引入口；当前前向工作流改看 `.planning/WORKSTREAMS.md`

## Reading Model

- 需要回答“产品是什么、当前系统真相是什么、长期要收口到哪里”，先读 `architecture/`
- 需要回答“顶层 capability routing、surface allowlist 与 admission/routing 分层如何设计”，读
  `architecture/system/capability-routing-and-admission-architecture.md`
- 需要回答“supervisor、structured runtime、agent handoff 与 SDK-native execution
  如何分层”，读
  `architecture/system/execution-and-agents-architecture.md`
- 需要回答“retrieval planner、bounded evidence、RAG side agent runtime 如何分层”，读
  `architecture/system/agentic-retrieval-architecture.md`
- 需要回答“用户系统、account center、auth runtime adapter、future muc.wiki login federation
  如何分层”，读
  `architecture/system/identity-platform-architecture.md`、
  `architecture/system/hub-account-experience-architecture.md` 与
  `architecture/system/federation-and-mucwiki-login-architecture.md`
- 需要回答“为什么接受这条边界”，读 `decisions/`
- 需要回答“接口、schema、指标或术语长什么样”，读 `contracts/`、`data/`、`reference/`
- 需要回答“MUC Campus Q&A 前端设计稿、页面边界、截图和 design token 是什么”，读
  `reference/muc-campus-qa-frontend-design/`
- 需要回答“source-channel 的 canonical data truth 是什么”，优先从 `data/` 进入，例如
  `data/official-web-source-truth-schema.md`、
  `data/authenticated-notice-source-truth-schema.md`、
  `data/wechat-official-account-source-truth-schema.md`
- 需要回答“如何部署、恢复、验收或操作”，读 `runbooks/`、`environment/`、`policies/`
- 需要按领域聚合同一主题下的多类材料，读 `domains/`
- 需要查看历史方案、completed closeout 或 supersession 关系，读 `plans/`

## Docs And Planning

- `docs/` 保存长期可引用的 repo truth，不承担 worktree-local 执行状态
- `architecture/current-architecture.md` 只描述当前 accepted merged truth，不描述 feature
  branch 进度
- `.planning/workstreams/<slug>/README.md` 是 native workstream 的 live
  入口；先看这里，再进入
  `STATE / ROADMAP / REQUIREMENTS`
- `docs/plans/` 已全部视为 archive namespace；当前 forward execution truth 固定在
  `.planning/WORKSTREAMS.md` 与 `.planning/workstreams/<slug>/`
- `plans/`、`reference/`、`runbooks/` 的非默认入口材料应优先收进各自 `archive/` 子目录，而不是继续堆在根层命名空间
- `.planning/PROJECT.md` 负责 repo 级当前真相；`.planning/WORKSTREAMS.md` 负责 repo 级
  workstream registry；单条线的 execution truth 固定在 `.planning/workstreams/<slug>/`

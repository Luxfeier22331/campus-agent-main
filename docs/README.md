---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-04-12
---

# Docs

`docs/` 是 `campus-agent` 的长期文档入口，承载可持续引用的架构、ADR、contract、data、policy、reference、runbook，以及仍对前向实施有指导价值的 plan。

## Canonical Entry Points

- [architecture/product-positioning.md](./architecture/product-positioning.md)
  - 产品定位、目标用户与产品边界
- [architecture/current-architecture.md](./architecture/current-architecture.md)
  - 当前 accepted merged truth
- [architecture/target-architecture.md](./architecture/target-architecture.md)
  - 长期目标架构与不可退回约束
- [../.planning/PROJECT.md](../.planning/PROJECT.md)
  - 当前项目级 active lane 与 pending work
- [../.planning/WORKSTREAMS.md](../.planning/WORKSTREAMS.md)
  - 当前 active / deferred / backlog workstreams 与 native planning 目录索引

## Documentation Areas

- [architecture/README.md](./architecture/README.md)
  - 产品定位、merged truth、supporting architecture
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
  - 仍应继续引用的前向实施计划

## Reading Model

- 需要回答“产品是什么、当前系统真相是什么、长期要收口到哪里”，先读 `architecture/`
- 需要回答“为什么接受这条边界”，读 `decisions/`
- 需要回答“接口、schema、指标或术语长什么样”，读 `contracts/`、`data/`、`reference/`
- 需要回答“如何部署、恢复、验收或操作”，读 `runbooks/`、`environment/`、`policies/`
- 需要按领域聚合同一主题下的多类材料，读 `domains/`
- 需要判断哪些 implementation material 仍对当前工作有效，读 `plans/`

## Docs And Planning

- `docs/` 保存长期可引用的 repo truth，不承担 worktree-local 执行状态
- `architecture/current-architecture.md` 只描述当前 accepted merged truth，不描述 feature branch 进度
- `plans/` 只保留仍有前向指导价值的计划；`completed`、`historical` 与 `superseded` plan 不进入默认入口
- `.planning/PROJECT.md` 负责 repo 级当前真相；`.planning/WORKSTREAMS.md` 负责 repo 级 workstream registry；单条线的 execution truth 固定在 `.planning/workstreams/<slug>/`

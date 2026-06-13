---
doc_type: index
truth_scope: capability
owner_boundary: domains/campus-services
status: active
created: 2026-04-23
updated: 2026-04-27
---
# Campus Services Domain

## 先看什么

- 架构总边界：`../architecture/domains/campus-services/architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 长期方向：`../architecture/target-architecture.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/domains/campus-services/architecture.md`
- `../contracts/service-status-lookup-contract.md`
- `../contracts/service-guide-lookup-contract.md`
- `../contracts/transport-schedule-lookup-contract.md`
- `../contracts/contact-directory-lookup-contract.md`
- `../decisions/adr-0005-campus-services-taxonomy.md`
- `../decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`
- `../reference/runtime-serving-and-index-terms.md`

## Data / Reference

- `../data/campus-services-service-guide-source-truth-schema.md`
- `../data/campus-services-contact-directory-source-truth-schema.md`
- `../data/campus-services-service-catalog-source-truth-schema.md`
- `../reference/student-handbook-normalization-strategy.md`
- `../reference/runtime-serving-and-index-terms.md`
- `../runbooks/index-release-runbook.md`

## 执行路由

- 当前 repo 级执行状态与 workstream registry 统一看 `README.md` 定义的通用执行态入口
- offline-preparation 质量硬化相关历史材料已经完成，默认不再作为 live 入口
- 如果后续恢复 structured runtime opening、projection query 或 acceptance 相关执行，优先回到
  `../../.planning/WORKSTREAMS.md` 与对应 workstream README

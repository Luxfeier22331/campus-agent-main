---
doc_type: index
status: active
created: 2026-03-22
updated: 2026-04-12
---

# Docs

`docs/` 默认保留当前有效、可直接消费的产品、架构、contract、runbook 与前向计划文档；
只有明确标记的 `historical` reference/runbook 才作为追溯或对照材料继续保留。
当前执行状态、worktree-local phase 产物与历史执行细节在 `.planning/`。

## 默认阅读路径

### 核心真相

- `architecture/product-positioning.md`
- `architecture/current-architecture.md`
- `architecture/target-architecture.md`

### 分区导航

- `architecture/README.md`
- `decisions/README.md`
- `contracts/README.md`
- `data/README.md`
- `runbooks/README.md`
- `reference/README.md`
- `domains/README.md`
- `environment/README.md`
- `plans/README.md`

### 当前执行状态

- `.planning/PROJECT.md`

### 接手当前 worktree 时再读

- `.planning/STATE.md`

## 信息架构

当前仓库采用“按用户需求分工、按系统边界组织”的文档结构。

- `architecture/`
  - 面向“为什么这样设计”和“系统长期应长成什么样”的说明型文档
- `decisions/`
  - 面向 architecturally significant decisions 的 ADR 集合
- `contracts/`
  - 面向 HTTP/runtime seam 的 reference 文档
- `data/`
  - 面向 schema、ownership 与 read-model/source-of-truth 划分的 reference 文档
- `reference/`
  - 面向查阅的术语、指标、清单、已落盘事实与质量证据
- `domains/`
  - 面向跨文档类型的领域导航页；只负责聚合入口，不创造新的架构真相
- `runbooks/`
  - 面向操作的可重复步骤与验收手册
- `plans/`
  - 面向前向实施的执行计划；它们不是当前架构真相，也不是 phase 历史档案馆
- `policies/`
  - 面向治理规则、quality gate 与 collection-specific 约束
- `environment/`
  - 面向环境变量 ownership 与模板入口

## Docs 与 `.planning/` 的分工

- `docs/`
  - 保留当前稳定有效、应被长期引用的文档
- `.planning/PROJECT.md`
  - 当前产品范围、validated/active/out-of-scope、关键决策与里程碑视角的项目真相
- `.planning/STATE.md`
  - 当前 worktree 的 focus、next active workstream、recent verification 与 session continuity
- `.planning/ROADMAP.md`
  - phase 编排、执行历史与 roadmap 顺序
- `.planning/phases/`、`.planning/quick/`
  - 某轮执行的上下文、研究、计划、总结与临时 handoff 产物

因此：

- 判断当前 merged truth，看 `architecture/current-architecture.md`
- 判断长期边界，看 `architecture/` 与 `decisions/`
- 判断当前项目级 phase 与 pending work，看 `.planning/PROJECT.md`
- 判断当前 worktree 的执行现场与 handoff，看 `.planning/STATE.md`
- 判断 contract / schema / read model，看 `contracts/` 与 `data/`
- 判断某件事如何操作，看 `runbooks/`
- 判断某份计划是否仍然有效，看 `plans/README.md`

重复控制规则：

- `architecture/current-architecture.md`
  - 只回答“当前 merged truth 是什么”
- 其他 supporting architecture
  - 只解释边界、ownership 与长期形态，不重复维护 phase 状态或 closeout 证据
- `contracts/`、`data/`
  - 只维护接口、schema 与 ownership reference，不承担当前执行状态说明
- `.planning/PROJECT.md`、`.planning/STATE.md`
  - 只维护当前 active lane、pending work 与 worktree-local continuity

## 状态语义

YAML front matter 统一保留，但不同文档类型使用不同状态集。

- `index`、`architecture`、`contract`、`data`、`policy`、`environment`
  - `active`
- `reference`、`runbook`
  - `active`
  - `historical`
- `decision`
  - `proposed`
  - `accepted`
  - `superseded`
  - `deprecated`
- `plan`
  - `active`
  - `deferred`
  - `completed`
  - `historical`
  - `superseded`

语义约束：

- `completed`
  - 已完成，默认退出阅读主路径，但仍可能保留作完成态 closeout 记录
- `historical`
  - 只保留历史基线、对照、迁移或追溯价值，不再代表前向执行路径或默认当前入口
- `deferred`
  - 能力仍被接受，但当前没有 active execution wave
- `superseded`
  - 已被更新文档替代，必须显式指向 replacement

## Landing Page 规则

每个顶层文档分区都应有自己的 `README.md` 作为 landing page。

固定规则：

- landing page 要提供概览和分组，不做超长平铺清单
- 默认分组尽量控制在可扫读范围内；一组超过 `7` 个链接时应继续分组
- `docs/README.md` 只列默认入口，不再充当全仓库大列表
- 历史基线、已完成 plan、一次性协作指令应退出默认阅读路径
- historical `reference` / `runbook` 也应退出默认入口，改由分区 landing page 的历史分组承接
- agent/tool 专属提示不得保留在长期文档正文里

## 分区入口

- 架构总览：`architecture/README.md`
- ADR 总览：`decisions/README.md`
- Contract 总览：`contracts/README.md`
- Data 总览：`data/README.md`
- Plan 总览：`plans/README.md`
- Runbook 总览：`runbooks/README.md`
- Reference 总览：`reference/README.md`
- Domain 总览：`domains/README.md`
- Policy 总览：`policies/README.md`
- Environment 总览：`environment/README.md`

## 默认 canonical 入口

当前默认 canonical 入口固定为：

- `architecture/product-positioning.md`
- `architecture/current-architecture.md`
- `architecture/target-architecture.md`
- `decisions/adr-0038-documentation-information-architecture-and-lifecycle.md`
- `contracts/app-api-http.md`
- `data/app-api-schema.md`
- `reference/runtime-serving-and-index-terms.md`

其余文档通过各分区 landing page 导航，不再在这里平铺罗列。

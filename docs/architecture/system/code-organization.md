---
doc_type: architecture
truth_scope: repository
owner_boundary: docs/architecture/system
status: active
created: 2026-06-03
updated: 2026-07-13
---
# Code Organization And Decomposition Architecture

## 文档边界

本文定义 `campus-agent` 的代码组织、目录分解与重复治理口径。它回答的是：

- 什么是可接受的小区块
- 什么是可审查的目录美感
- 哪些重复必须归并到 owner module
- 结构约束应该由什么证据证明

它不负责：

- 宣称当前实现已经全部符合本文规则
- 替代 `docs/architecture/current.md` 的 runtime / product topology
- 替代 `.planning/` 中的 active workstream 状态
- 直接列出本轮需要重构的文件清单

## 组织原则

代码应按能力 owner、runtime boundary 与 domain responsibility 分割成可独立理解的小区块。

可接受的小区块必须同时满足：

- 有明确 owner，读者能从路径判断它服务哪个 app、package、domain 或 runtime seam
- 有明确输入输出，不靠跨目录隐式共享状态才能理解
- 与相邻模块的边界能用 contract、DTO、schema、route、store 或 service interface 解释
- 测试靠近责任边界，能证明这个小区块的 public behavior

不可接受的小区块包括：

- 只为绕过行数 gate 机械拆出来的碎片
- 名称泛化但内容混杂的 helper / utils / common 垃圾桶
- 同时服务多个 app、多个 runtime seam 或多个 domain owner 的无主模块
- 需要读完整个调用链才能知道职责的薄包装文件

## Top-Level Directory Boundaries

- `apps/*` 承载长驻 product app、browser surface、Worker / service runtime 或
  transport boundary。
- `jobs/*` 承载一次性或定时 deployable runtime，例如 Kubernetes Job /
  CronJob、Docker manual command 或本地 manual sync 任务。
- `packages/*` 与 `packages/domains/*` 承载稳定库、contract、domain/tool
  boundary 与可复用逻辑，不拥有
  transport lifecycle 或 deploy entrypoint。

`jobs/*` 是 runtime boundary，不是脚本垃圾桶。能进入 `jobs/*` 的代码必须有清晰
deploy identity、输入环境、失败语义与验证命令。只有本地开发辅助、不需要部署或调度的工具仍应留在
`scripts/` 或 owner package 的 `scripts/` 下。

`scripts/` 只承载 repo-level executable entrypoints 与共享 deploy / env primitives。
通用格式、安全和配置语法检查直接调用成熟工具；领域、contract 和 runtime 不变量由 owner package
或 app 测试证明。不得新增中央目录允许列表、历史路径扫描器或为旧检查入口提供兼容 wrapper。

Temporal workflow / activity worker、Crawlee crawler runtime、Postgres / S3 /
Qdrant concrete client lifecycle 与 provider HTTP client 默认属于 `apps/*` 或
`jobs/*` runtime boundary。`packages/*` 只能暴露 runtime-neutral contract、DTO、
interface、纯 helper 或 domain logic；不得为了复用方便把具体 runtime framework、
queue/storage handle、数据库连接生命周期或 deploy-time env bootstrap 下沉到 package。

## 目录美感

目录美感在本仓库中不是主观审美，而是可审查的结构质量。它至少包括：

- 同类模块目录同构，命名对称，文件职责可预测
- app/job 边界与 package 边界清晰，不把 transport/runtime 细节混进 tool package
- domain-specific 能力留在 domain owner 内，不新增 shared bucket 承载业务逻辑
- helper 文件服务一个明确 owner，不承担跨 owner 的业务归并
- 测试、fixture、schema、script 与被验证的 owner 保持可追溯关系

结构性拆分应优先恢复正确 owner，而不是先追求文件数量均匀。目录看起来整齐但边界错误，仍然是不合格结构。

## 测试布局

package 级测试默认使用 TS-first 布局：

- TS package 的单元 / contract / schema 测试放在 owner package 的 `test/`
  目录，并通过该 package 的 `test` / `typecheck` script 进入。
- `tests/` 目录只用于有真实调用者的 Python runtime island；当前仅
  `packages/ragas-runner/tests` 使用 Python unittest。
- 共享 contract truth 由 JSON Schema / OpenAPI、TS checker 和 owner TS tests
  证明，不维护无调用者的 Python mirror 或 adapter smoke。
- Python 测试不得使用 `load_tests` 聚合或 `from ... import *`。这些模式会隐藏
  discovery 范围，导致 CI 显示通过但实际 suite 被跳过。

这条规则通过 owner package 的 typecheck/test 和代码评审维护，不再由中央目录扫描器重复表达。

## 不重复原则

同一概念只能有一个 owner module。重复治理优先看语义，不只看文本相似度。

必须归并或抽取的重复包括：

- 同一 DTO、schema、contract、route exposure 或 env projection 在多个 app/job/package
  中手写复制
- 同一业务判断、admission rule、authz rule、query surface rule 在多个消费层重复表达
- 同一 runtime command、smoke setup 或 evidence shape 在多个 runbook/script 中分叉维护
- 同一命名表、alias、category、surface registry 在多个位置各自维护 truth

允许保留重复的条件必须明确：

- 重复位于不同 runtime boundary，且共享实现会泄漏不该暴露的 runtime 类型或依赖
- 重复是测试 fixture 的刻意隔离，并且 fixture 明确指向 canonical source
- 重复是文档索引对同一 source-of-truth 的入口引用，不重新维护细节

出现第三次同类重复前，必须选择一个 owner module 或 owner document 归并。不能用“先跑通”作为继续复制的理由。

## 验证语义

`pnpm repo:static` 只证明 Biome、Markdownlint 与 EditorConfig Checker 覆盖的通用格式和文本卫生。
模块 owner、目录结构、语义重复与 runtime boundary 不能由中央扫描器可靠推断，必须通过 owner tests、
相关 architecture/contract 文档和实际 diff 共同评审。

## Review Contract

涉及结构性改动时，review 至少检查：

- 新增目录是否能从路径读出 owner
- 新增文件是否有单一职责
- 新增 helper 是否只服务一个 owner
- 是否存在第三处同类逻辑重复
- 是否把 app/runtime 细节泄漏到 package tool 层
- 是否把 package/domain 规则复制到 app shell
- 是否为了 smoke、demo 或临时验证新增双路径

如果当前实现不符合本文规则，应记录为实现问题或 backlog。消费层不能用兼容逻辑、猜测补齐或静默成功来掩盖结构缺陷。

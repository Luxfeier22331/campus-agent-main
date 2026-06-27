---
doc_type: architecture
truth_scope: repository
owner_boundary: docs/architecture/system
status: active
created: 2026-06-03
updated: 2026-06-03
---
# Code Organization And Decomposition Architecture

## 文档边界

本文定义 `campus-agent` 的代码组织、目录分解与重复治理口径。它回答的是：

- 什么是可接受的小区块
- 什么是可审查的目录美感
- 哪些重复必须归并到 owner module
- `pnpm repo:static` 内部 decomposition checker 能证明什么，不能证明什么

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

## 目录美感

目录美感在本仓库中不是主观审美，而是可审查的结构质量。它至少包括：

- 同类模块目录同构，命名对称，文件职责可预测
- app 边界与 package 边界清晰，不把 transport/runtime 细节混进 tool package
- domain-specific 能力留在 domain owner 内，不把业务逻辑堆进 `packages/shared`
- helper 文件服务一个明确 owner，不承担跨 owner 的业务归并
- 测试、fixture、schema、script 与被验证的 owner 保持可追溯关系

结构性拆分应优先恢复正确 owner，而不是先追求文件数量均匀。目录看起来整齐但边界错误，仍然是不合格结构。

## 不重复原则

同一概念只能有一个 owner module。重复治理优先看语义，不只看文本相似度。

必须归并或抽取的重复包括：

- 同一 DTO、schema、contract、route exposure 或 env projection 在多个 app/package 中手写复制
- 同一业务判断、admission rule、authz rule、query surface rule 在多个消费层重复表达
- 同一 runtime command、smoke setup 或 evidence shape 在多个 runbook/script 中分叉维护
- 同一命名表、alias、category、surface registry 在多个位置各自维护 truth

允许保留重复的条件必须明确：

- 重复位于不同 runtime boundary，且共享实现会泄漏不该暴露的 runtime 类型或依赖
- 重复是测试 fixture 的刻意隔离，并且 fixture 明确指向 canonical source
- 重复是文档索引对同一 source-of-truth 的入口引用，不重新维护细节

出现第三次同类重复前，必须选择一个 owner module 或 owner document 归并。不能用“先跑通”作为继续复制的理由。

## Gate 语义

`pnpm repo:static` 内部的 `scripts.check_decomposition_tracked` 是基础分解 gate。它证明的是：

- tracked handwritten code/test 没有新增超预算大文件
- 当前 decomposition baseline 没有被静默扩张

它不能证明：

- 模块 owner 正确
- 目录结构同构
- 没有语义重复
- helper 没有变成垃圾桶
- runtime boundary 没有被穿透

因此结构性改动的 review 需要同时检查本文规则、相关 architecture 文档与实际 diff。通过
decomposition checker 只能作为必要证据，不能作为充分证据。

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

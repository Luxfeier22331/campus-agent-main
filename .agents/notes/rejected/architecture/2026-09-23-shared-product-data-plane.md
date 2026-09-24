# Agent Note: Main checkout 共享产品数据平面

Status: rejected — 当前架构已采用每个 worktree 独立本地数据平面

## 背景

当前本地流程把共享容器、worktree profile 和产品数据初始化绑定在一起：PostgreSQL database 与 derived bucket
按 worktree 创建，Qdrant collection 却由共享容器承载，`campus_docs_serving.current_index` 又随数据库分开。
`dev:init --data cluster` 因此可以在任意 worktree 触发完整数据复制，造成数据库、对象存储和 Qdrant 不属于同一个
数据 owner。main checkout 已经有真实产品数据时，linked worktree 仍会重复拉取或 seed，失败后还可能留下半套资源。

用户需求只有两个边界：

1. 从集群把真实数据同步到本地；
2. linked worktree 消费 main checkout 管理的共享基础设施数据。

现有的[协作开发产品数据初始化](../../implemented/process/2026-09-17-product-data-initialization.md)中“本地数据库和派生对象属于 profile”的决定与这两个边界冲突。本笔记只提议取代该部分 owner 与生命周期，不取代 seed、fixture、Qdrant serving 或对象存储内容寻址合同。

## 提案

### Main checkout 是唯一数据平面 owner

canonical checkout 管理一套本地产品数据平面：

- 一个产品 PostgreSQL database，包含当前产品投影和 `campus_docs_serving.current_index`；
- 一个本地 derived bucket，包含 `campus-docs/source.json`、reader、补充对象、图片和其他产品附件；
- 共享本地 Qdrant 及当前混合 Docs/Notice collection。

只有 main checkout 可以执行集群同步、schema/bootstrap、Qdrant materialize、`current_index` 激活和共享数据修复。
同步命令读取集群的 `pg-product-data-ro`、`objectstore-ro` 和 `qdrant-ro`，将最终内容写入上述本地服务；JSON/NDJSON
只作为事务传输和校验格式，不作为最终数据 owner。

同步完成的判断必须同时覆盖 PostgreSQL、derived bucket、Qdrant collection 和 current binding；只存在生成目录、
snapshot metadata 或单独的 JSON 文件不算数据 ready。

### Linked worktree 只消费 main 数据平面

linked worktree 的 `dev:init` 只负责：

- 注册本 worktree 的端口、进程环境和本地运行 secret；
- 读取 main checkout 的数据平面连接信息；
- 生成指向 main database、shared derived bucket 和 shared Qdrant 的应用配置；
- 执行只读 readiness 检查。

linked worktree 不创建或删除产品 database/bucket，不执行 cluster pull，不 materialize Qdrant collection，不写
`campus_docs_serving.current_index`，也不把 Docs source 闭包复制到 profile bucket。worktree 之间共享产品数据，
而应用端口和进程生命周期仍保持独立。

### 命令边界

将流程拆成两个明确入口：

```text
main checkout:  dev:sync-data --context <context> --namespace <namespace>
linked worktree: dev:init --target core
```

`dev:sync-data` 只允许在 main checkout 运行；`dev:init` 在 linked worktree 默认不再 seed 或复制产品数据。
合成 seed 与 `build:fixture` 保留为基础测试入口，不作为真实对话初始化路径。

### 生命周期和失败边界

数据同步按以下顺序执行：

1. 校验 main checkout 共享 PostgreSQL、RustFS 和 Qdrant 已 ready；
2. 从集群读取完整产品表快照、Docs 引用闭包和当前 Qdrant collection；
3. 在临时 staging 区校验 schema、digest、reader 引用、point payload 和 vectors；
4. 将 reader/assets 写入共享 derived bucket，并将候选 collection 写入共享 Qdrant；
5. 验证 collection 的 point 数、payload、dense/sparse vectors 和 Docs/Notice 引用；
6. 在产品数据库事务中写入产品投影并激活 `current_index`；
7. 回读固定 `campus-docs/source.json` 和当前 collection，报告统一 ready 结果。

任何阶段失败都不允许 linked worktree 自行补数据或混入 seed。旧 current binding 保持有效；同步命令可以在 main
checkout 重试同一来源。共享数据清理和 worktree 销毁不得删除当前产品 database、bucket 或 collection。

## 未采用方案

- **继续为每个 worktree 复制数据库和 derived bucket**：能保持资源隔离，但违背“worktree 消费 main 共享数据”，并使
  Docs source、数据库 current binding 和共享 Qdrant 产生不同步状态。
- **只把 main 的 JSON/snapshot 文件挂载给 worktree**：不能提供 PostgreSQL 产品投影、Qdrant vectors 或对象引用
  闭包；JSON 只能作为交换或诊断格式。
- **让每个 worktree 直接从集群同步**：会重复消耗远端连接和本地存储，允许多个 worktree 同时改变共享 Qdrant，且
  没有单一 current binding owner。
- **用 Qdrant snapshot 或 PostgreSQL volume 直接覆盖本地容器**：绕过 schema、对象引用、point 校验和当前绑定合同，
  也无法保持 worktree 运行配置与数据 owner 的一致性。
- **在本次重构中增加 worktree 间账号、会话或运行记录隔离层**：这是独立的数据边界需求；当前目标只要求统一真实产品
  数据平面，后续若需要隔离再单独设计 schema/database owner。

## 验收标准

- main checkout 执行同步后，`dev:doctor --scope data` 同时确认产品 PostgreSQL、固定 Docs source、共享 Qdrant
  current collection 和 `current_index` 一致；
- linked worktree 执行 `dev:init --target core` 不创建新的 product database 或 derived bucket，不请求集群 Secret，
  且生成的应用配置指向 main checkout 数据平面；
- 两个 linked worktree 的真实 `campus_search` 查询读取同一 collection 和同一 Docs source；
- linked worktree 无法调用数据同步、materialize collection 或 current pointer 写入路径；
- `build:fixture` 和 seed 测试仍能独立运行，不改变共享真实数据；
- main 数据同步失败时，current binding 不被替换，linked worktree 继续消费上一份已验证数据；
- 文档、测试和 cleanup 命令不再把 profile bucket/database 描述为产品真实数据 owner。

## 风险

- linked worktree 共享产品数据库后，产品投影和 current binding 的写权限必须只保留给 main 数据同步/发布 owner；应用运行时
  继续使用既有受限角色。
- main checkout 数据平面不可用时，所有 linked worktree 的真实对话验证都会同时受影响；`dev:doctor` 必须把这类状态明确
  报告为 shared data unavailable。
- 当前已有 profile database/bucket 可能成为过期资源；迁移完成后只能按明确 instance/profile 清单回收，不能用全量 bucket
  或 collection 扫描推断删除范围。

## 拒绝理由

本提案与已实施的[每个 worktree 的独立本地数据平面](../../implemented/architecture/2026-09-24-independent-worktree-data-plane.md)冲突。当前需求要求 worktree 可独立启动、销毁和迁移，不能让 linked worktree 依赖 main checkout 的 PostgreSQL、RustFS、Qdrant 或 current index owner；因此不采用共享产品数据平面。

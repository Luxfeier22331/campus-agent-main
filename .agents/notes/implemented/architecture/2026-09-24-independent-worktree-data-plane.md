# Agent Note: 每个 worktree 的独立本地数据平面

Status: implemented

## 背景

共享 PostgreSQL、RustFS、Qdrant 和 Temporal 会让 linked worktree 依赖主 checkout 的运行状态，并迫使开发工具维护共享 bucket、只读连接、current pointer 和兼容命令。这样一个 worktree 的销毁、重建或检索发布都可能影响其他 worktree，数据 owner 也无法从 profile 直接判断。

## 决策

每个 worktree profile 独立拥有四类本地基础设施：PostgreSQL、RustFS、Qdrant 和 Temporal。profile 为每类服务分配不重叠的 loopback 端口、Compose project、卷、网络、凭据、数据库、source bucket、derived bucket 和 Temporal namespace。`dev:init` 只启动当前 profile 的 Compose project；`dev:destroy` 只删除当前 project 及其卷，不再执行共享 reconcile 或跨 worktree清理。

真实集群同步写入当前 worktree 的独立数据库、对象存储和 Qdrant。同步闭包包括 Docs source 引用闭包、当前混合 Campus RAG collection、current index，以及 Qdrant notice points 引用的通知详情、分类、类型、组织和资产；不复制用户、session、Dining、Transport 或 Groups 业务数据。候选 Docs 对象和 Qdrant collection 完成完整校验后才激活 current index，失败时保留旧 pointer。

检索表同步使用 upsert；只删除没有本地 Transport 通知链接或处理失败记录依赖的过期通知，并保留这些本地依赖所需的通知与资产，避免 PostgreSQL 级联删除改变未同步的业务状态。

代码直接硬切到 V3。旧 V1/V2 profile、registry 和共享开发资源不再由 CLI 转换；发现旧格式时 fail-closed，并提示开发者人工删除旧文件、容器、网络和数据卷后重新初始化。仓库不自动删除这些机器资源，也不保留旧迁移入口。

应用统一使用当前 profile 的 `OBJECT_STORE_*`、`EXECUTION_CONTROL_DATABASE_URL`、当前 profile Qdrant 和 Temporal 配置。`CAMPUS_DOCS_OBJECT_STORE_*`、`CAMPUS_DOCS_SERVING_DATABASE_URL`、`dev:sync-retrieval` 和 `dev:shared-reconcile` 不再属于本地运行合同。

主线新增的通知 pipeline/artifacts Worker 沿用相同 profile 的对象存储、数据库、Qdrant 和
Temporal namespace；初始化保留主线的 schedule 创建，不重新使用机器级固定端口或凭据。
集群同步是唯一的真实数据入口，保留主线的 Embedding Set 引用闭包和索引 catalog 注册合同；普通 doctor 只检查入口，
完整对象与检索点校验仍由显式 data scope 承担。

## 未采用方案

- **继续共享四类容器，只隔离应用数据库**：会保留跨 worktree 的销毁、凭据和 current pointer 风险，也无法让 Compose project 成为明确 owner。
- **只复制 JSON 到 worktree**：不能替代对象存储 reader、Qdrant 向量和数据库 current pointer，且会产生第二套未被应用消费的数据格式。
- **让 V2 profile 自动映射到 V3 资源**：会把旧共享数据误认为独立数据，造成数据丢失或静默切换，因此旧 profile 只能人工清理后重新初始化。

## 后果

本地并发开发会消耗更多端口、磁盘和启动时间；代价换来 worktree 级别的可销毁性、可复现性和 owner 清晰度。真实 cluster 同步必须为每个需要在线检索验证的 worktree 单独执行。切换后不再维护共享检索兼容层；机器级缓存仍可共享，但不承载业务数据。

# Agent Note: 每个 worktree 的独立本地数据平面

Status: implemented

## 背景

共享 PostgreSQL、RustFS、Qdrant 和 Temporal 会让 linked worktree 依赖主 checkout 的运行状态，并迫使开发工具维护共享 bucket、只读连接、current pointer 和兼容命令。这样一个 worktree 的销毁、重建或检索发布都可能影响其他 worktree，数据 owner 也无法从 profile 直接判断。

## 决策

每个 worktree profile 独立拥有四类本地基础设施：PostgreSQL、RustFS、Qdrant 和 Temporal。profile 为每类服务分配不重叠的 loopback 端口、Compose project、卷、网络、凭据、数据库、source bucket、derived bucket 和 Temporal namespace。`dev:init` 只启动当前 profile 的 Compose project；`dev:destroy` 只删除当前 project 及其卷，不再执行共享 reconcile 或跨 worktree清理。

本地 source 隔离取代[对象存储](./2026-07-16-object-storage.md)原先仅覆盖 derived bucket 的约定；
集群 source/derived 分工与默认名称继续有效。采集器与其他消费者读取 profile 生成的 bucket 配置。

真实集群同步写入当前 worktree 的独立数据库、对象存储和 Qdrant。同步闭包包括 Docs source 引用闭包、当前混合 Campus RAG collection、current index，以及 Qdrant notice points 引用的通知详情、分类、类型、组织和资产；不复制用户、session、Dining、Transport 或 Groups 业务数据。候选 Docs 对象和 Qdrant collection 完成完整校验后才激活 current index，失败时保留旧 pointer。

检索表同步使用 upsert；只删除没有本地 Transport 通知链接或处理失败记录依赖的过期通知，并保留这些本地依赖所需的通知与资产，避免 PostgreSQL 级联删除改变未同步的业务状态。

代码直接硬切到 V3。旧 V1/V2 profile、registry 和共享开发资源不再由 CLI 转换；发现旧格式时 fail-closed，并提示开发者人工删除旧文件、容器、网络和数据卷后重新初始化。仓库不自动删除这些机器资源，也不保留旧迁移入口。旧的 standalone Qdrant Compose 已退役，普通本地 Qdrant 只由当前 profile 的 `docker-compose.dev.yml` 供应；独立 TLS 检查环境继续保留。

main checkout 与 linked worktree 使用相同规则。此次 main 硬切销毁旧共享容器、网络和卷，清理旧 profile 及其托管连接后，从 seed 重建独立 V3 实例；不复制旧共享数据，集群真实数据同步留作后续显式操作。已有 V3 worktree 不受影响。

应用统一使用当前 profile 的 `OBJECT_STORE_*`、`AGENT_CONTROL_DATABASE_URL`、当前 profile Qdrant 和 Temporal 配置。`CAMPUS_DOCS_OBJECT_STORE_*`、`CAMPUS_DOCS_SERVING_DATABASE_URL`、`dev:sync-retrieval` 和 `dev:shared-reconcile` 不再属于本地运行合同。

通知采集和状态版本维护由采集模块统一解析 source 对象存储连接，bucket、endpoint 和凭据均由环境
显式提供；本地通知分类同样要求 `OBJECT_STORE_BUCKET_SOURCE`，不限制固定桶名。维护命令的查询、
备份、删除和输出使用实际 bucket。集群采集 Job 模板与执行定时采集的 `notice-pipeline-worker`
Deployment 均显式声明 `OBJECT_STORE_BUCKET_SOURCE`，不能以业务代码中的默认桶名补齐缺失配置。
部署配置测试从实际 Worker 容器提取环境变量并调用采集模块的连接构造函数；只检查手动 Job 模板
不能覆盖定时采集的配置合同。集群同步的远端资源仍由目标集群约定决定，不能套用本地 worktree bucket。

主线新增的通知 pipeline/artifacts Worker 沿用相同 profile 的对象存储、数据库、Qdrant 和
Temporal namespace；初始化保留主线的 schedule 创建，不重新使用机器级固定端口或凭据。
集群同步是唯一的真实数据入口，保留主线的 Embedding Set 引用闭包和索引 catalog 注册合同；普通 doctor 只检查入口，
完整对象与检索点校验仍由显式 data scope 承担。

## 未采用方案

- **保留业务代码默认桶名**：可减少环境配置，但会使缺失配置被解释为访问另一桶，与 worktree 资源归属冲突。
  部署配置负责提供具体值；协议常量与 OCR 固定策略不因本地资源隔离而全部转成环境变量，也不建立全仓库常量中心。

- **继续共享四类容器，只隔离应用数据库**：会保留跨 worktree 的销毁、凭据和 current pointer 风险，也无法让 Compose project 成为明确 owner。
- **只复制 JSON 到 worktree**：不能替代对象存储 reader、Qdrant 向量和数据库 current pointer，且会产生第二套未被应用消费的数据格式。
- **让 V2 profile 自动映射到 V3 资源**：会把旧共享数据误认为独立数据，造成数据丢失或静默切换，因此旧 profile 只能人工清理后重新初始化。

## 后果

本地并发开发会消耗更多端口、磁盘和启动时间；代价换来 worktree 级别的可销毁性、可复现性和 owner 清晰度。真实 cluster 同步必须为每个需要在线检索验证的 worktree 单独执行。切换后不再维护共享检索兼容层；机器级缓存仍可共享，但不承载业务数据。

冷启动 Qdrant 的 seed upsert 可能超过单请求默认期限，因此本地初始化的 Qdrant 发布请求保留更长的
有界期限、中断和 publisher lock 信号，不增加重试。Docs source 探测补齐 `probeLocalObject` 导入，
确保 doctor 检查真实对象；本地服务健康检查统一使用 Docker healthcheck，postgres 不再豁免。

2026-09 复核发现 slot 间隔 100 下 Qdrant 宿主端口与 Temporal 端口相差 900，slot 9 与 slot 0 的实例会互相占用端口。Qdrant 宿主映射从 26333/26334 调整为 26343/26344（容器内 6333/6334 不变），并在 profile 测试中穷举校验 slot 0–99 全部宿主端口全局唯一。存量实例的 profile 存储旧端口，派生变化后其所在 worktree 的 `dev`/`dev:init`/`dev:doctor` 按 fail-closed 报错；注册表级校验只保留身份检查，`dev:instances`、`dev:prune` 和 `dev:destroy` 仍可枚举和销毁漂移实例。迁移路径为先 `dev:destroy` 再重新 `dev:init`（本地卷随销毁删除，真实检索数据可从集群重同步），不提供原地端口改写。

同批复核发现实例凭据随 worktree 删除后（人工删 worktree 而非 `dev:destroy`），prune 指向的 destroy 会因 per-instance 凭据文件缺失而 fail-closed。Compose project 的容器、卷和网络靠 project label 识别，不依赖实例凭据，因此 destroy 先按 label 执行 `docker compose --project-name <project> down --volumes --remove-orphans` 清理；清理后按 Compose project label 复查，全部不存在时按"资源已缺失"释放注册表；仍有残留时 fail-closed 并提示人工清理后重试。

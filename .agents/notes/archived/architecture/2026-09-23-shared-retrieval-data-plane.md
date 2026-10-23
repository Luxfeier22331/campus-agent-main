# Agent Note: 本地共享检索数据平面

Status: implemented

## 背景

本地每个 worktree 都有自己的 PostgreSQL database 和派生 bucket，但真实对话验证需要同一份 Docs source、统一的混合 Campus RAG collection 和当前 collection 指针。原来的 `dev:init --data cluster` 把完整产品表、Docs 对象、Qdrant points 和 `current_index` 一起复制到任意 worktree，导致数据 owner 与运行数据库混淆，也允许多个 worktree 修改共享检索状态。

## 决策

canonical checkout 是本地检索数据平面 owner。`pnpm dev:sync-retrieval -- --context <context> --namespace <namespace>` 只能从 canonical checkout 执行，读取集群当前 `campus_docs_serving.current_index`、Docs source 引用闭包和对应的混合 Qdrant collection。同步先校验 Docs 引用和统一 point contract，再写入 canonical derived bucket、共享 Qdrant，并更新 canonical database 的 `campus_docs_serving.current_index`。同步不复制 Notices、Dining、Transport 或其他业务表。

linked worktree 的 `dev:init` 只创建自己的运行数据库、应用用户、模型配置、Temporal namespace 和进程环境。`core` 不再创建 profile derived bucket，也不执行 seed、cluster pull、Qdrant materialize 或 current pointer 写入。它通过独立配置消费 canonical Docs bucket、共享 Qdrant 和 `campus_docs_index_ro` 对 canonical `current_index` 的只读连接。`EXECUTION_CONTROL_DATABASE_URL` 继续只负责本 worktree 的运行状态；`CAMPUS_DOCS_SERVING_DATABASE_URL` 专门负责检索 index store。

Campus Web 使用 `CAMPUS_DOCS_OBJECT_STORE_*` 读取共享 Docs 对象；普通 `OBJECT_STORE_*` 仍属于各应用的业务对象存储配置。Qdrant 继续复用已有共享容器和只读查询凭据。共享 current-index 读取角色只获得目标 database 的 connect、schema usage 和 `current_index` select 权限。

seed、fixture 和每个 worktree 的业务数据库仍保留，供基础验证和产品 UI 本地行为使用；它们不被当作真实 Campus RAG 数据源。共享同步通过既有生命周期锁串行化 Qdrant materialize 和 pointer activation。

## 未采用方案

- **每个 worktree 继续完整拉取集群数据**：会复制业务表和 Docs 对象，并允许多个 owner 改写同一 Qdrant 数据，违反共享检索数据边界。
- **把 canonical 数据导出为 JSON 给 worktree**：JSON 不能替代对象存储 reader、Qdrant vectors 或 current-index 查询连接；NDJSON 只作为同步临时传输。
- **让 execution-control 直接复用运行数据库连接**：会把 worktree 运行状态和 canonical 检索 pointer 混在一起，且无法表达只读权限。
- **把所有对象存储配置切换到共享 bucket**：App API、Ops 和用户附件仍有各自业务 owner，只有 Docs reader 使用专用共享配置。

## 后果

canonical checkout 的检索数据不可用时，所有 linked worktree 的真实 Campus Search 验证都会受影响；`dev:doctor --scope data` 会检查共享 pointer、Docs source 和 Qdrant collection。linked worktree 的业务表仍可独立 seed、修改和销毁，销毁不会删除 canonical bucket、collection 或 current pointer。

完整产品数据初始化笔记中的“每个 profile 拥有真实产品数据库、派生对象和 current binding”范围由本决定部分取代；其中关于 seed、fixture、显式替换和统一 serving point contract 的内容继续有效。

Archived: 2026-09-23 — superseded by [替代笔记](../../implemented/architecture/2026-09-24-independent-worktree-data-plane.md)

# Agent Note: 协作开发产品数据初始化

Status: implemented

## 背景

UI worktree 曾有空通知表和不完整的检索绑定，初始化流程却只检查分类、群组或独立领域计数。
共享 Docs source 也使不同 worktree 的文档读写无法隔离。协作者需要无需集群的真实 seed，
以及不借用应用管理员凭据的产品数据拉取方式。

## 决策

扩展既有 `dev:init`，core 和 ops-web 使用同一完整产品数据范围；其他 Job target 保持自身 bootstrap。
默认 seed 使用版本控制内的样例和现有 builder 生成的真实 Qwen3-Embedding-4B 向量。
日期只在初次写入时生成，重复初始化保留本地编辑。已有数据不完整时不混入 seed，替换必须显式
`--replace`，并清理依赖基础数据的本地食堂评论、编辑和举报；用户、会话、模型配置保留。

cluster 模式显式选择 context/namespace，使用 product_data_ro、objectstore-ro、qdrant-ro。
范围包含产品与内容管理草稿，不包含原始门户采集、远端用户/会话/评论/模型秘密。
附件只有元数据；图片、Docs 全版本引用闭包和食堂 SVG 复制实际字节。
PostgreSQL 在单个 repeatable-read read-only 事务导出显式列；Qdrant 从 current_index 指向的真实
collection 分批读取 dense/sparse vectors。只有需要反复遍历的 Qdrant points 使用临时 NDJSON，
取消信号同时传递给分页下载和重试等待，临时文件在成功或失败后清理。
对象直接交给各消费者，Docs 编译器复用已读取字节，制品导入复用自身收集的字节；
不再增加本地对象暂存文件或独立磁盘缓存。

本地基础验证数据库和派生对象属于 profile；真实 Docs 对象、混合 Qdrant collection 与
`campus_docs_serving.current_index` 的共享 owner 由[本地共享检索数据平面](../architecture/2026-09-24-independent-worktree-data-plane.md)
定义。不可变 Qdrant collection 可共享，绑定独立。
初始化要求当前 worktree 应用离线。统一 publisher 的 catalog 支持调用方事务，基础数据与绑定
一起提交。资源和 collection 先验证，随后导入数据库，最后更新 Docs source；Docs closure 在一次编译中读取并
校验对象，再直接复用已读取字节写入目标对象；Qdrant 下载阶段不重复做产品语义校验，统一在写入
前校验。后续失败报错，
重复相同显式替换命令收敛。共享 registry lock 串行化本地 collection 写入。

Docs-only 本地 current_index writer 退役；保留 Chunk、Embedding、评测与统一显式制品发布入口。
共享 Qdrant 纳入既有 shared-reconcile，复用 project/volume/keys；新安装生成私有本地密钥。
正常启动及已有数据的 seed 重复初始化只做轻量数据入口检查；初始化成功后不再隐式执行全量诊断。
完整对象和索引引用验证使用显式 `dev:doctor --scope data`，直接复用消费链检查，不重复读取浅层入口。
业务表为空不代表同步失败，不以通知、群组、交通或食堂发布表非空判断 ready；实际引用必须可解析，
数据库约束继续由数据库承担。样例覆盖由 seed 测试保证，`hasProductData` 只负责防止意外覆盖。
入口缺失与引用损坏按实际失败报告，不把所有诊断失败都引导到覆盖本地数据。
缺少索引返回 `campus_search_unavailable`；其他检索或引用合同失败不因此变成可恢复错误。

## 未采用方案

- 自动 merge/upsert 可保留部分本地内容，但会形成 seed 与真实内容混合且不完整的集合；采用明确替换。
- 要求开发者手工指定两个 Embedding Set 可复用制品导入，但 current_index 不保存这些身份；
  产品同步直接读取当前 collection，不为同步扩展 serving 元数据。
- 每次初始化现场调用 embedding provider 能即时生成向量，但会引入成本和外部依赖；提交小型真实产物，
  测试检查它们与当前内容、构建器和引用一致。
- 浏览器 smoke 固定成命令或 PR CI 可以自动触发，但不符合已确认的资源开销决策；浏览器按需 MCP 验收。

## 后果

产品初始化和数据诊断由 `scripts/dev` 拥有，领域 schema、renderer、builder 与 publisher 仍由原模块拥有。
根脚本显式声明使用的 embedding 和 dining workspace 依赖，使 CI 仅安装根验证依赖时也能解析复用的 publisher；
不能依赖开发机器完整安装留下的子包链接。
本地真实 PostgreSQL/S3/Qdrant 已验证 seed、保留编辑、显式替换，以及 product_data_ro 的正反向权限。
数据 ready 与模型配置、进程健康、真实 provider 请求分别判断。集群新增身份须先完成 GitOps 凭据和
Source 角色/迁移交付；本地权限验证不替代线上协作者验收。操作入口见
[本地运行检查](../../../../docs/runbooks/local-verification.md)。

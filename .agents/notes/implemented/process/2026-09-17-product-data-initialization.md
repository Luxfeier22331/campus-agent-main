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

cluster 模式使用 product_data_ro、objectstore-ro、qdrant-ro；连接全程只读。
namespace 默认 `campus-agent-staging`（staging 是仓库唯一承认的部署 namespace，属部署拓扑事实而非机器细节），
`--namespace` 可覆盖；`--context` 缺省时省略 kubectl `--context`，回落到本机 kubectl current-context
（与 RAG index publisher 的 `context?` 可选行为一致），跨集群时显式补 `--context`。
原"两个 flag 都必须显式"的 fail-closed 已由只读身份校验兜底：`pg.username !== "product_data_ro"` 或
TLS 配置不全时 `connectProductCluster` 直接报错，默认 namespace 指错集群也不会写入。
当前 `cluster` 范围为检索通知表、Docs 引用闭包及当前混合索引，不包含群、班车、食堂或远端用户/会话/评论/模型秘密。
附件只有元数据；通知图片、Docs 全版本引用闭包复制实际字节。seed 继续覆盖完整基础内容；内容页验收另用下述 `cluster-content`。
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

2026-09-30 Ops 实际验收要求少量真实通知且不复制图片，增加 `cluster-content` 模式，复用当前 profile、
只读集群连接和既有基础表列投影。默认取最近 100 条通知并补齐班车引用，群、班车、地图与菜单全量读取。
只复制选中通知的 source JSON，因为 Ops 正文预览的实际消费者读取 source bucket，而非数据库正文列；
不下载图片、附件文件、Docs、食堂 SVG 或向量索引，也不连接集群 Qdrant。基础表替换复用原事务和依赖评价
清理，清除与部分通知不再一致的本地 current_index；不增加部分索引或页面 fallback。该模式由内容验收
需求驱动，完整检索同步继续使用 `cluster`；若内容验收也要求完整资源，重新评估此模式即可。

## 未采用方案

- 自动 merge/upsert 可保留部分本地内容，但会形成 seed 与真实内容混合且不完整的集合；采用明确替换。
- 要求开发者手工指定两个 Embedding Set 可复用制品导入，但 current_index 不保存这些身份；
  产品同步直接读取当前 collection，不为同步扩展 serving 元数据。
- 每次初始化现场调用 embedding provider 能即时生成向量，但会引入成本和外部依赖；提交小型真实产物，
  测试检查它们与当前内容、构建器和引用一致。
- 浏览器 smoke 固定成命令或 PR CI 可以自动触发，但不符合已确认的资源开销决策；浏览器按需 MCP 验收。

## 后果

产品初始化和数据诊断由 `scripts/dev/product-data` 拥有，本地环境生命周期由 `scripts/dev/lifecycle` 拥有，
两者仅通过 lifecycle 的 profile（决定数据落点）耦合；`scripts/dev/cli.ts` 留在根作为统一命令入口。
此前所有 product-data 文件与 lifecycle 文件混在 `scripts/dev/` 平铺目录，拆分为两个子目录以物理化子域边界；
biome 对 fixture 的 ignore 路径同步到 `scripts/dev/product-data/fixtures`，`scripts/package.json` 的 `test:dev`
glob 扩为 `dev/*.test.ts dev/*/*.test.ts`。领域 schema、renderer、builder 与 publisher 仍由原模块拥有。
根脚本显式声明使用的 embedding 和 dining workspace 依赖，使 CI 仅安装根验证依赖时也能解析复用的 publisher；
不能依赖开发机器完整安装留下的子包链接。
本地真实 PostgreSQL/S3/Qdrant 已验证 seed、保留编辑、显式替换，以及 product_data_ro 的正反向权限。
数据 ready 与模型配置、进程健康、真实 provider 请求分别判断。集群新增身份须先完成 GitOps 凭据和
Source 角色/迁移交付；本地权限验证不替代线上协作者验收。操作入口见
[本地运行检查](../../../../docs/runbooks/local-verification.md)。

2026-09-30 在 `ops-web-redesign` 的独立本地实例完成实际替换：105 条通知（最近 100 条加 5 条班车引用）、53 个群、6 条线路、28 个时间段、125 个班次、1 个地图发布版本；复制正文 JSON 共 887367 字节，未下载二进制资源。真实 Ops 列表和正文预览返回 200。新增模式与既有产品数据测试 14 项、生命周期测试 40 项通过；图片／附件与检索不属于该次验收覆盖。

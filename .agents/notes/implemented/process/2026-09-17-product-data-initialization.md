# Agent Note: 协作开发产品数据初始化

Status: implemented

`dev:init` 自动导入产品数据、全局替换和隐式模型/Hindsight 初始化已由
[本地开发初始化与数据域 owner](../architecture/2026-10-03-local-development-initialization-ownership.md) 部分取代。
以下关于只读身份、检索原子发布、真实样例制品、独立通知同步与对象合同的理由继续有效。

## 背景

UI worktree 曾有空通知表和不完整的检索绑定，初始化流程却只检查分类、群组或独立领域计数。
共享 Docs source 也使不同 worktree 的文档读写无法隔离。协作者需要无需集群的真实 seed，
以及不借用应用管理员凭据的产品数据拉取方式。

## 决策

扩展既有 `dev:init`，core 和 ops-web 使用同一完整产品数据范围；其他 Job target 保持自身 bootstrap。
默认 seed 使用版本控制内的样例和现有 builder 生成的真实 Qwen3-Embedding-4B 向量。
日期只在初次写入时生成，重复初始化保留本地编辑。已有数据不完整时不混入 seed，替换必须显式
`--replace`，并清理依赖基础数据的本地食堂评论、编辑和举报；用户、会话、模型配置保留。
通知 seed 由同一 Chunk builder 传入 `released_at`，提交的 Chunk Run 使用当前 `notice_chunk_run.v2` 合同。
发布时间只属于点的 metadata，不进入 `retrievalText`；因此仅 metadata 变更时复用已有 embedding，更新
Chunk Run、Embedding Set manifest 和 seed index 的绑定，不直接改写旧的不可变制品。

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

统一 publisher 的 Qdrant 写入仅在响应体 `result.status` 为 `completed` 时继续内容校验。
本地真实服务已复现 `wait=true` 返回 HTTP 200、`wait_timeout`，随后 exact count 为零；
只看 HTTP 成功会把写入未完成误报为种子数量不匹配。客户端直接保留操作状态报错，复用既有
候选清理流程；不改变 current pointer，也不增加自动重试。该判断由统一 publisher 的 Qdrant
客户端拥有，供产品初始化与索引发布共同消费。

分块修复验收另提供 `dev:sync-notices`，只复用 PostgreSQL 协作者只读身份，复制通知及其引用的
分类、类型和组织。用户需要自己生成 Chunk/Embedding，不需要既有 Docs、向量、图片或附件，
因此该入口不经过 core 初始化或完整检索同步；数据库关系沿用真实 ID，不生成替代关联。
需要指定时间段的真实通知时，同一入口接受成对的 `--released-from` / `--released-to`，以北京时间的
`released_at` 半开区间选择通知，再导出选中记录引用的分类、类型与组织。选择条件由类型化参数传给
导出函数，不另建范围同步脚本；无参数保留全量行为。筛选不影响采集维护区间，也不要求通知已发布。
四张表在集群一致快照中读取，在本地单事务内 upsert 并逐字段验证。它与数据初始化共用当前
profile 的数据操作锁，数据库写锁允许应用继续读取旧的已提交数据；只更新源数据，不改变索引绑定。
本次导入之外的本地记录保留并单独报告，包括可分块的额外记录数；范围外记录仍可能参与后续全库分块，
因此 `local_extra_*` 保持全库口径。空结果不删除记录，本轮同步不清理本地业务引用。
该行为只适用于显式的通知同步入口，不改变 seed 的替换规则。将来若通知评测需要消费图片或附件，
再按实际输入需求扩展范围。

core 的记忆页面需要真实 Hindsight；本地初始化将其纳入现有 capability、Compose project、
端口分配和清理边界。provider 配置从独立 Hindsight 环境变量注入，tenant key 与 owner salt
由当前 worktree 凭据文件生成并复用，防止重初始化改变用户 bank。已有 profile 补入按 slot
派生的新端口，保留其数据库与其他端口。独立 Compose 使用 overlay，修正 ports/networks
误嵌 healthcheck 的错误；不再采用固定共享网络或手改托管环境文件。

本地 derived bucket 初始化同时设置与部署环境一致的 `dining/floorplans/*` 匿名 `GetObject`
策略。App API 的平面图代理使用不带签名的读取；仅创建桶、复制 SVG 会导致 RustFS 返回 403，
最终页面收到 502。策略使用当前 profile 的桶名，重复初始化会补齐已有桶；source 桶及其他
对象前缀不开放匿名读取。修复已有环境只需执行桶初始化，无需替换通知、数据库或索引数据。

## 未采用方案

- seed 替换时自动 merge/upsert 可保留部分本地内容，但会形成混合且不完整的基础集合；seed 采用明确替换。
  仅通知同步按用户要求保留本地独有记录，通过额外记录报告明确分块输入范围。
- 要求开发者手工指定两个 Embedding Set 可复用制品导入，但 current_index 不保存这些身份；
  产品同步直接读取当前 collection，不为同步扩展 serving 元数据。
- 每次初始化现场调用 embedding provider 能即时生成向量，但会引入成本和外部依赖；提交小型真实产物，
  测试检查它们与当前内容、构建器和引用一致。
- 浏览器 smoke 固定成命令或 PR CI 可以自动触发，但不符合已确认的资源开销决策；浏览器按需 MCP 验收。
- 延长写入等待时间可能缓解慢磁盘，但不能修复 HTTP 200 被误当作操作完成的问题；本次先准确判断
  完成状态，保持既有等待时间和失败清理行为。

- 为通知分块验收运行完整 cluster 同步可直接获得在线检索环境，但会复制当前任务不消费的 Docs 和向量；
  独立通知入口只提取已有数据库连接、字段映射和 upsert 能力，不新建采集或索引流程。

## 后果

产品初始化和数据诊断由 `scripts/dev/product-data` 拥有，本地环境生命周期由 `scripts/dev/lifecycle` 拥有，
两者通过 lifecycle 的 profile 决定数据落点；完整初始化入口保持 `scripts/dev/cli.ts`，
仅通知同步入口为 `scripts/dev/product-data/notice-sync-cli.ts`。
此前所有 product-data 文件与 lifecycle 文件混在 `scripts/dev/` 平铺目录，拆分为两个子目录以物理化子域边界；
biome 对 fixture 的 ignore 路径同步到 `scripts/dev/product-data/fixtures`，`scripts/package.json` 的 `test:dev`
glob 扩为 `dev/*.test.ts dev/*/*.test.ts`。领域 schema、renderer、builder 与 publisher 仍由原模块拥有。
根脚本显式声明使用的 embedding 和 dining workspace 依赖，使 CI 仅安装根验证依赖时也能解析复用的 publisher；
不能依赖开发机器完整安装留下的子包链接。
seed、保留编辑、显式替换，以及 product_data_ro 的正反向权限由本地数据测试覆盖。数据 ready 与模型配置、
进程健康、真实 provider 请求分别判断。集群新增身份须先完成 GitOps 凭据和 Source 角色/迁移交付；
权限测试不替代线上协作者验收。操作入口见
[本地运行检查](../../../../docs/runbooks/local-verification.md)。

2026-09-30 在 `ops-web-redesign` 的独立本地实例完成实际替换：105 条通知（最近 100 条加 5 条班车引用）、53 个群、6 条线路、28 个时间段、125 个班次、1 个地图发布版本；复制正文 JSON 共 887367 字节，未下载二进制资源。真实 Ops 列表和正文预览返回 200。新增模式与既有产品数据测试 14 项、生命周期测试 40 项通过；图片／附件与检索不属于该次验收覆盖。

写入回归覆盖 `completed`、`wait_timeout`、`acknowledged` 和缺失操作结果；未完成写入不得进入
内容校验，仍清理本次新建候选。修复纠正失败归因，不消除本机存储延迟。

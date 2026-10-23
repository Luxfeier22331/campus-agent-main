# Agent Note: 检索构建与索引应用改为一次性 Job

Status: implemented

## 背景

通知制品 Worker 把分块、Embedding、索引发布和退休版本清理放在每次通知刷新中，发布需要完整向量和
point 集合驻留内存。文档规模按 100k 篇设计，Qdrant 必须留在当前单节点，明确不需要回滚。

## 决策

通知 Temporal Worker 只负责采集、分类和正文发布。检索由同一镜像的 build、apply、cleanup 三个
一次性 Job 承担，均由运维显式触发，不让常驻应用或 Temporal 获取 Kubernetes Job 创建权限。

Build 不访问 Qdrant，保留现有领域分块算法和制品格式。生产 NDJSON 流式读写；文本去重、向量关联和
point 生成使用 Job 私有 SQLite 磁盘工作区，不新增持久化业务账本。工作区随 Pod 临时卷删除。
批次、请求大小和并发限制控制内存，规模增加消耗工作磁盘和处理时间。
大制品使用串行 multipart 上传，避免单次 PUT 成为制品规模上限；共享对象的清理范围同时覆盖 Docs 和 Notice。

Apply 沿用版本化 collection：名称 `campus_docs_<revision>` 由两个 Embedding Set 和 collection
definition 推导，与旧 publisher 一致。Apply 写入新 collection 并校验，然后在一个事务中切换
`current_index`，宽限期后删除上一个 collection。Search 每次请求读取一次指针、不持锁，Agent 继续用
collection 名做 run 内索引一致性绑定。相同输入不写入；切换前失败时旧 collection 继续服务。
Apply 只删除本数据库上一次指向的 collection，因为本地开发实例共享同一个 Qdrant。
`current_index` 新增 Docs/Notice 制品引用列，替代 `index_versions` 的引用登记；删除 previous
collection 和回滚入口，不保留旧 Workflow 兼容。

Cleanup 只处理显式退休制品，并保护所有保留 manifest 仍引用的对象。三个 Job 由 publisher
advisory lock 互斥，与旧 publisher 使用同一锁名。清理按数据、Chunk manifest、Embedding Set 根
manifest 的顺序删除，失败后相同命令可以重新执行；仅待删除闭包中明确不存在的对象视为已完成，保留
引用缺失和其他存储错误仍报错。current_index 的 collection 与其制品引用推导结果不一致时拒绝清理，
覆盖旧 Worker 在滚动发布期间切换指针而不写引用的窗口。

本决定部分取代[通知统一流水线](2026-09-20-notice-pipeline-unification.md)的制品编排、自动索引刷新和
回滚部分，保留通知采集、分类、发布、固定 Workflow ID 和 Ops 运行展示的职责。

## 发布

schema 只做扩展：新增可空引用列并从 `index_versions` 回填，不改 collection 约束，不删除旧表和旧列。
滚动发布期间旧 Worker、旧 Ops Web 和新 Search 都能读写同一结构。三个旧镜像通过 Source
`infra/k8s/topology/retirements.json` 在同一次选版中从 GitOps overlay 移除。发布成功后运维执行一次
Build/Apply 完成首次切换；`index_versions` 与 `previous_collection` 在发布完成后由收缩迁移删除。

2026-10-18 staging 首次 Apply 切换到新 collection 后，收缩迁移删除旧表和旧列；schema maintenance
校验改为检查 `agent_control` 对 `current_index` 的读写权限。旧 publisher 遗留的 37 个 collection
已由运维一次性删除。

## 未采用方案

固定 collection 原地更新曾是本分支的初版：Apply 进入 applying 状态，持排他锁阻塞 Search，失败后保持
不可用直到重建，并要求维护窗口。它的依据是单节点不能同时保存两份索引，但 staging Qdrant 的实际压力
来自旧 publisher 未清理的数十个退休 collection，当前和上一版本各约 257 MiB；发布内存问题也已由流式
处理解决。原地更新还让 schema 迁移把指针指向尚不存在的 collection，使新 Search 在首次重建前不就绪，
阻塞 Kargo 的健康等待。版本化切换只在切换期间多占一份磁盘，因此不采用固定 collection 和维护窗口。

常驻索引 Worker 可以维持自动刷新，但索引写入由运维控制时效，一次性 Job 更符合它的生命周期。
全量数组改大内存只能移动失败规模，无法让处理内存随批次受控，因此采用磁盘工作区和迭代处理。
把 run 绑定改为独立 revision 字段会让新旧 runtime 和 control 在滚动发布期间互不兼容，collection 名
已经唯一对应 revision，不改绑定合同。

## 后果

通知正文发布不会立即更新检索，运维控制索引时效。Apply 期间检索不中断；失败后旧索引继续服务，修复后
用同一组制品重跑。旧 publisher 遗留的其他退休 collection 不被自动删除，由运维核对后一次性处理。
不以压测或完整 promotion 端到端验证为前提。

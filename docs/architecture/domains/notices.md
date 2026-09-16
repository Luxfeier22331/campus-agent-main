---
doc_type: architecture
owner_boundary: domains/notices
status: active
---
# 通知

## 边界

通知领域接收时效性较强、结构不稳定的校园公告及附件。来源采集和模型分类是离线过程；经显式
规范化的通知可以由学生产品读取，但不会自动成为规范规章、校历事实、知识索引或模型工具。

## 数据与消费链路

```text
来源系统
-> internal-portal-collection
-> 来源对象与数据库通知登记
-> 模型或维护者写入单一用户分类
-> notice-publisher
-> 已发布正文与 derived 资源
   ├-> App API -> Campus Web
   └-> Notice Chunk Run v1 -> Notice Embedding Set
       -> Campus RAG unified publisher -> campus_search
```

internal-portal-collection 在通知模式中写入来源对象和原始资源，并在资源齐备后登记数据库库存；
文件发布模式只写入来源对象。分类使用一个 `category` 表示标题表达的主要用途，不再把业务领域和
内容形态拆成两个相互竞争的筛选维度。例如基金申报归
`research_affairs`，没有更强业务流程的学术讲座预告归 `lectures_forums`，楼宇开放关闭归
`campus_operations`。分类不表示领域处理、对外发布或用户阅读已经完成。

采集同时提供本地 CLI 和复用同一实现的一次性 Job 入口。通知维护状态使用
`[covered_from, covered_until)` 半开区间：notice-sync 只推进排他上界，notice-backfill 只扩展包含下界。
ingestion runtime base 为通知增量、通知回填和文件发布分别提供一个固定动作、默认暂停的模板，不提供
自动调度；通知分类同时提供本地 CLI 和默认暂停的在线 Job：两者只消费标题，在线 Job 将结果写回通知
数据库。凭据由 Ops Web 候选池解析，本地写入当前 worktree 的受管理环境文件，采集 Job 只在当前进程内
使用，不形成 TGC Secret。

notice-publisher 读取数据库中已有分类且未发布的通知，显式物化正文与资源并打开学生端可见边界；对已发布站内通知也可通过独立的
重新发布操作重新物化正文投影，但保持学生端可见边界不变。本地 CLI 与默认暂停的 Kubernetes Job 模板使用同一实现，不提供自动
schedule。App API 和 Campus Web 只读取 `is_published=true` 的投影。完整
数据结构和操作顺序分别由 [通知数据](../../data/notices.md) 和
[采集运行](../../runbooks/ingestion.md) 维护。

下游领域必须通过自己的校验和发布入口消费通知。稳定制度正文可以显式提升为规章，已核对的日期
安排可以成为校历参考；没有下游发布器的通知仍只是通知数据。

## 在线边界

App API 提供会话保护的目录、站内详情和图片读取。目录用 `stream=notices|campus_news` 分开通知与
校园动态；通知视图可以按 13 个用户分类筛选，`unclassified` 可被读取但不作为筛选项或徽标。外链
通知从目录直接前往已校验来源，不抓取外部正文。站内详情提供需要用户门户登录态的原文和附件链接；
App API 不代理附件字节。

`campus_notices/internal_notice` 不进入 Docs builder。Notice 的独立 builder 从已发布正文生成 Chunk 与
Embedding 制品；统一 Publisher 才拥有 Qdrant 发布和当前绑定。制品与查询交接由
[检索服务](../system/retrieval-serving.md)维护，字段与内容语义由[通知数据](../../data/notices.md)维护。

Agent 不能扫描通知对象存储或 PostgreSQL，也不提供通知结构化查询或附件解析；已发布通知只通过
`campus_search` 的统一检索入口进入模型上下文。离线问题生成和评测仍只消费与目标 Chunk Run 对齐的
本地产物，不能把分类配置、本地 Chunk 或评测产物视为已部署产品能力。分类、schema、读取接口、页面
源码和本地制品存在都不表示任一环境已经完成资源回填、统一索引发布或部署。

## 相关文档

- [通知数据](../../data/notices.md)
- [通知接口](../../contracts/app-api/notices.md)
- [采集运行](../../runbooks/ingestion.md)
- [内部门户文件发布采集](../../contracts/internal-portal-file-release.md)
- [内部门户通知来源合同（认证通知来源）](../../../.agents/notes/implemented/architecture/2026-08-14-internal-portal-notice-source.md)
- [内部门户通知来源合同](../../../.agents/notes/implemented/architecture/2026-08-14-internal-portal-notice-source.md)
- [规范化通知存储](../../../.agents/notes/implemented/architecture/2026-08-14-normalized-notice-storage.md)
- [通知维护状态收敛](../../../.agents/notes/implemented/architecture/2026-08-25-notice-maintenance-state.md)

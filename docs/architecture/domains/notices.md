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
-> source-collector
-> 来源对象
-> 模型生成单一用户分类
-> 分类 derived 制品
-> notice-publisher
-> notices.* 与 derived 资源
-> App API
-> Campus Web
```

source-collector 只产生来源对象和原始资源。分类使用一个 `category` 表示标题表达的主要用途，
不再把业务领域和内容形态拆成两个相互竞争的筛选维度。例如基金申报归
`research_affairs`，没有更强业务流程的学术讲座预告归 `lectures_forums`，楼宇开放关闭归
`campus_operations`。分类不表示领域处理、对外发布或用户阅读已经完成。

采集当前以本地命令运行；源码另有复用同一 sync 的一次性 Job 入口，但尚未部署或调度。通知分类同时
提供本地 CLI 和默认暂停的在线 Job：两者只消费标题，Job 将结果写入 derived 分类制品。凭据由 Ops Web
候选池解析，本地写入当前 worktree 的受管理环境文件，采集 Job 只在当前进程内使用，不形成 TGC Secret。

notice-publisher 在资源齐备且分类完整性校验通过后显式物化规范化投影；App API 和 Campus Web 只读取
该投影。完整数据结构和操作顺序分别由 `../../data/notices.md` 和
`../../runbooks/ingestion.md` 维护。

下游领域必须通过自己的校验和发布入口消费通知。稳定制度正文可以显式提升为规章，已核对的日期
安排可以成为校历参考；没有下游发布器的通知仍只是通知数据。

## 在线边界

App API 提供会话保护的目录、站内详情和图片读取。目录用 `stream=notices|campus_news` 分开通知与
校园动态；通知视图可以按 13 个用户分类筛选，`unclassified` 可被读取但不作为筛选项或徽标。外链
通知从目录直接前往已校验来源，不抓取外部正文。站内详情提供需要用户门户登录态的原文和附件链接；
App API 不代理附件字节。

`campus_notices/internal_notice` 不是当前 Campus Docs publisher 的输入。Agent 不能扫描通知对象存储或
PostgreSQL，也不提供通知结构化查询、附件解析、embedding 或 RAG，不能把通知分类配置视为产品
能力。分类、schema、读取接口和页面源码存在都不表示任一环境已经完成资源回填、规范化写入或部署。

## 相关文档

- `../../data/notices.md`
- `../../contracts/app-api/notices.md`
- `../../runbooks/ingestion.md`
- `../../contracts/internal-portal-file-release.md`
- `../../decisions/adr-0024-authenticated-notice.md`
- `../../decisions/adr-0087-internal-portal-notice-source.md`
- `../../decisions/adr-0088-normalized-notice-storage.md`

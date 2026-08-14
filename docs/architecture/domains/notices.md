---
doc_type: architecture
owner_boundary: domains/notices
status: active
---
# 通知

## 边界

通知领域接收时效性较强、结构不稳定的校园公告及附件。来源采集是离线过程；经人工确认和显式
规范化的通知可以由学生产品读取，但不会自动成为规范规章、校历事实、知识索引或模型工具。

## 数据与消费链路

```text
来源系统
-> source-collector
-> 来源对象
-> 人工确认唯一领域
-> notice-publisher
-> notices.* 与 derived 资源
-> App API
-> Campus Web
```

source-collector 只产生来源对象和原始资源。分类只确定一条通知的内部领域，不表示领域处理、对外
发布或用户阅读已经完成。notice-publisher 在资源齐备后显式物化规范化投影；App API 和 Campus Web
只读取该投影。完整数据结构和操作顺序分别由 `../../data/notices.md` 和
`../../runbooks/ingestion.md` 维护。

下游领域必须通过自己的校验和发布入口消费通知。稳定制度正文可以显式提升为规章，已核对的日期
安排可以成为校历参考；没有下游发布器的通知仍只是通知数据。

## 在线边界

App API 提供会话保护的目录、站内详情和图片读取。外链通知从目录直接前往已校验来源，不抓取外部
正文。站内详情提供需要用户门户登录态的原文和附件链接；App API 不代理附件字节。

通知当前不在查询目标注册表中。Agent 不能扫描通知对象存储或 PostgreSQL，也不提供通知结构化查询、
附件解析、embedding 或 RAG。分类、schema、读取接口和页面源码存在都不表示任一环境已经完成资源
回填、规范化写入或部署。

## 相关文档

- `../../data/notices.md`
- `../../contracts/app-api/notices.md`
- `../../runbooks/ingestion.md`
- `../../contracts/internal-portal-file-release.md`
- `../../decisions/adr-0087-internal-portal-notice-source.md`
- `../../decisions/adr-0088-normalized-notice-storage.md`

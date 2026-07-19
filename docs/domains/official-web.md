---
doc_type: domain
owner_boundary: sources/official-web
status: active
---

# 公开官网采集

## 边界

`official_web.capture` 是离线来源任务。它只在配置允许的站点和预算内发现、抓取、提取并校验
公开页面，结果进入来源对象存储和最新抓取状态。

它不是在线搜索、通知服务、内容发布系统或查询目标。当前仓库只提供合成站点配置，用于验证
采集实现，不表示真实学校站点已经准入或部署。

## 职责

- `configs/sources/official_web` 定义允许的站点、种子、抓取预算和质量规则；
- source-collector 负责页面发现、HTTP 或浏览器抓取、正文提取、质量校验和来源产物；
- ingestion-control 负责任务准入、Temporal 工作流和最新抓取状态；
- Temporal 保存执行、重试、超时、心跳和取消；
- 对象存储保存请求、页面、抓取观测和来源清单；
- PostgreSQL 只保存下一次抓取所需的最新调度状态，不保存正文或抓取历史。

## 抓取规则

- 请求不能扩大配置允许的协议、主机、路径和发现方式；
- 抓取遵守 robots、并发、间隔、页数和运行时间限制；
- 优先使用 HTTP，只有页面行为确实需要时才使用浏览器；
- 列表和导航页面可以发现网址，但不会因此成为可回答正文；
- 条件请求和内容摘要用于识别未变化页面，不制造虚假版本；
- 删除、请求失败、解析失败和质量失败保留明确状态；
- Temporal 取消传播到来源请求、浏览器和产物写入。

精确站点值、预算、合同版本和对象命名由配置、实现和测试维护。

## 产物与在线边界

跨运行时来源引用必须包含摘要和字节数。稳定页面正文与每次抓取的响应、重定向、发现路径和失败
观测分别管理；重试不能改写已经存在且内容一致的稳定来源产物。

`official_web` 当前不在查询目标注册表中。采集完成不会自动生成规范文档、分块、索引、阅读器
发布或模型工具，在线请求也不能回退到实时抓取。

## 相关文档

- [采集数据面](../architecture/system/data-plane.md)
- [Temporal 采集决策](../decisions/adr-0077-ingestion.md)
- `configs/sources/official_web/README.md`
- `apps/source-collector/README.md`

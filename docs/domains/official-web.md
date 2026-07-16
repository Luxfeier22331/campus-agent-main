---
doc_type: domain
owner_boundary: sources/official-web
status: active
---

# 公开官网采集

## 边界

`official_web.capture` 是离线来源采集任务。它在配置允许的站点和预算内发现、抓取、
提取并校验公开页面，把来源产物写入对象存储，并维护下次抓取所需的最新网址状态。

它不是在线搜索供应商、通知服务、内容发布系统或在线知识目标。当前仓库中的
`muc_public` 使用 `example.edu` 合成配置，只用于校验配置和采集代码，不证明真实学校站点
已经准入或部署。

## 执行链路

```text
对象存储中的 official_web_capture_request.v1
-> ingestion-control 准入并启动 Temporal workflow
-> ingestion-control 根据最新网址状态生成有界准备清单
-> source-collector 发现、抓取、提取和校验
-> 对象存储中的 official_web_source_manifest.v1
-> ingestion-control 更新最新网址与种子状态
```

- `configs/sources/official_web/<site>` 拥有站点、主机、种子、抓取预算和质量规则；
- `apps/source-collector/adapters/official-web` 拥有 Crawlee 发现、HTTP/浏览器抓取、
  提取、质量检查和产物写入；
- `apps/ingestion-control` 拥有任务准入、Temporal 工作流、抓取准备和最新状态更新；
- Temporal 保存执行、重试、超时、心跳和取消状态；
- 对象存储保存请求、准备清单、页面、观测和结果清单；
- PostgreSQL 只保存最新网址和配置种子状态。

## 抓取规则

- 只允许配置声明的 scheme、主机、路径和发现方式；请求不得扩大准入范围。
- 抓取必须遵守配置的 robots、并发、间隔、页数和运行时间上限。
- 优先使用 HTTP；只有配置和页面行为需要时才使用浏览器渲染。
- 列表或导航页可以发现网址，但不因此成为可回答内容。
- 已知 `ETag` 或 `Last-Modified` 时使用条件请求；`304` 和内容摘要未变不产生
  虚假内容变更。
- 删除、请求失败、解析失败和质量失败必须保留明确状态，不得用整页原始文本冒充成功提取。
- Temporal 取消必须传播到供应商请求、Crawlee、浏览器和后续产物写入。

配置文件拥有具体主机、通道、预算、质量阈值和保留动作；本文不复制这些快速变化的值。

## 产物与数据

跨运行时引用必须包含 SHA-256 和字节数。正式页面使用
`official_web_page_manifest.v2`，来源包使用 `official_web_source_truth_bundle.v2`。请求、
准备清单、原始响应、抓取观测和结果清单按
`runs/<run-id>/attempts/<activity-attempt>/` 隔离。

写入使用“创建或校验”：已有 key 只有在摘要和字节数都相同时才能复用。因此内容未变的
重试不得改写正式来源字节。抓取时间、响应头、重定向链、发现路径和失败信息属于当次观测，
不进入稳定正文。

PostgreSQL 只保存：

- `ingestion_control.official_web_url_freshness`：以站点和规范网址为标识，保存最新抓取
  结果、校验器、摘要、周期、优先级和下次可抓取时间；
- `ingestion_control.official_web_seed_state`：以站点和配置种子网址为标识，保存其最近
  观测到的规范网址。

两类表都是最新调度状态，不是抓取历史、正文库、产物清单或发布记录。只有更新的
`(observed_at, run_id)` 才能覆盖已存状态。

## 在线边界

`official_web` 不在 `configs/runtime/query-serving-targets.v1.json` 中。采集完成不会创建规范
文档、分块、向量、别名或模型可见工具，也不允许在线请求回退到实时抓取。只有所属内容的清洗、发布、
检索和评测合同都存在并明确准入后，才能进入在线链路。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/decisions/adr-0077-ingestion.md`
- `configs/sources/official_web/README.md`

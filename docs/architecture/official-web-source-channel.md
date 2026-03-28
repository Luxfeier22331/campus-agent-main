---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Official Web Source Channel

## 文档边界

本文冻结 repo 级 `official_web` source channel 的长期边界与运行形态。

它回答的是：

- `official_web` 在 `campus-agent` 数据平面里承担什么职责
- crawler / collector、对象存储、registry、ingestion worker 之间如何分层
- operator 挂载独立 Docker 定期采集并上报时，系统边界应如何定义

它不负责：

- URL 允许范围、sitemap、robots、参数 URL、重试和限速细则
- web source-truth 的字段级 schema
- 某个站点、某个 collection 的 projection 规则
- collector 的具体代码实现、镜像构建步骤或某个部署平台的 YAML

对应文档：

- crawl 规则：`docs/architecture/official-web-crawl-policy.md`
- web source-truth schema：`docs/architecture/official-web-source-truth-contract.md`
- phase-1 数据平面不变量：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 对象存储与 object key 不变量：`docs/decisions/adr-0002-local-minio-conventions.md`
- repo 级 source-truth shared contract：`docs/architecture/source-truth-normalization-contract.md`

## 目标

`official_web` source channel 的目标是把官网与其他受控公开网页来源纳入统一的 `Raw -> Processed -> Chunk/Index` 数据平面，同时保持以下约束：

- 公开网页抓取是独立 source channel，不是某个 collection 的私有脚本
- 采集端可以由 operator 在独立环境中以 Docker 任务形式定期运行
- 采集端只负责 crawl / fetch / normalize / report，不直接决定下游 serving truth
- 同一份网页 source-truth 可以像 handbook 一样 fan-out 到多个下游 collection / corpus

## 核心结论

- `official_web` 是 repo 的一级 `source_channel`，与 `pdf_ocr`、`manual_curated` 并列，而不是 `campus_services` 的别名。
- `official_web` 的 canonical 运行形态是独立部署的 collector Docker job，而不是 `apps/ingestion-worker` 内嵌的长驻抓取线程。
- 调度是 collector 外部 concern；镜像默认只执行单次 crawl run，不在容器内部内置 cron。
- collector 只负责上游 source asset 与 source-truth 产物，不直接写 document registry、Qdrant 或 query-serving runtime。
- 中心 ingestion/runtime 仍然是 document registry、projection、chunking、embedding、indexing 的唯一真相写入方。

## 系统形态

`external scheduler -> official-web collector Docker job -> object storage (capture/provider/source-truth) -> raw asset registration / crawl run report -> ingestion worker / projection replay -> document registry -> chunk/index`

这条链路里的边界固定如下：

- scheduler 负责“什么时候跑”
- collector 负责“采到什么、如何规范化、如何上报”
- ingestion worker 负责“哪些 source-truth 进入哪些下游 collection / corpus”
- retrieval / serving 只消费 registry 与 Qdrant，不反向理解 crawl 细节

## 角色划分

### Collector

collector 是 `official_web` source channel 的执行 runtime。

它负责：

- 读取 repo-tracked site config、host policy、seed URLs 与凭证配置
- 维护 crawl frontier、去重、host 级节流、重试与 run state
- 获取网页 retained snapshot
- 执行 URL canonicalization 与 parser-specific extraction
- 产出 `capture/`、`provider/`、`source-truth/` artifacts
- 生成 crawl run manifest、host summary、failure report
- 向中心数据面上报 raw asset / crawl run 结果

它不负责：

- 直接创建或修改 document registry record
- 把网页直接投影为下游逻辑文档
- chunking、embedding、indexing
- Qdrant alias / collection release
- query-serving 开关
- 自行决定 `official_web` 与 `pdf_ocr` / `manual_curated` 的文档主来源优先级

### Scheduler

scheduler 是 collector 外部的 orchestration layer。

可接受形态包括：

- Kubernetes `CronJob`
- systemd timer
- CI / workflow scheduler
- operator 的受控批处理平台

无论采用哪种平台，repo 级 contract 固定为：

- 每次调度都启动一次性 collector run
- 同一站点允许重新执行相同计划
- collector run 必须幂等

### Central Ingestion

中心 ingestion 负责：

- raw asset registry 真相写入
- persisted source-truth 之后的 projection fan-out
- document registry 写入与版本推进
- chunking、embedding、indexing
- 与 `official_web`、`pdf_ocr`、`manual_curated` 的多来源合并

collector 不得绕过这层直接写入下游真相。

## 运行模型

### 单次 run

一次 collector run 是单个 site config 在某个时间窗内的一次 crawl batch。

它至少应有：

- `site_id`
- `crawl_run_id`
- `started_at`
- `finished_at`
- `host_set`
- `seed_set`
- `collector_version`
- `config_version`

### 定期运行

“定期采集”由 scheduler 表达，不由镜像内部表达。

原因固定为：

- 容器内部 cron 不利于幂等与审计
- 外部 scheduler 更适合控制并发、失败重试、暂停与回滚
- 一次性 run 更符合 crawl manifest / replay / operator approval 的边界

### 幂等要求

单次 run、重试 run、重复上报都必须安全。

repo 级要求固定为：

- collector 对同一页面必须能稳定计算 URL identity
- object storage 写入必须允许重试
- raw asset registration 必须允许 upsert / dedupe
- 相同 `site_id + normalized_canonical_url + content_hash` 的重复上报不得制造重复真相

## 采集端部署形态

operator-facing 交付形态固定为：

- 一份通用 collector Docker image
- 一份 repo-tracked site config
- 一组 environment / secret 注入点

这意味着：

- 采集人员不需要部署完整主系统
- 采集人员不持有 Qdrant、document registry 或 serving runtime 的直写权限
- 同一个 collector 可服务多个站点，但每次 run 必须绑定到明确的 `site_id`

## 配置 ownership

`official_web` 的配置 ownership 在 source config，而不在 `configs/ingestion/<corpus>/<collection>/`。

长期正确的配置形态固定为：

- `configs/sources/official_web/<site_id>/site.json`
- `configs/sources/official_web/<site_id>/hosts.json`
- `configs/sources/official_web/<site_id>/seeds.json`
- `configs/sources/official_web/<site_id>/crawl-policy.json`
- `configs/sources/official_web/<site_id>/credentials.schema.json`
- `configs/sources/official_web/<site_id>/projection-declarations.json`

原因：

- source-truth ownership 在 source asset，不在 collection
- 同一站点未来可能 fan-out 到多个 corpus / collection
- host allowlist、seed URLs 与 crawl policy 是 source-level truth，不应散落到 collection runtime profile

## 上报边界

collector 的上报边界固定为：

- object storage source artifacts
- crawl run manifest / summary / failure report
- raw asset registration request

当前不允许 collector 直接上报：

- document registry records
- chunk dumps
- embeddings
- Qdrant points
- query-serving metadata

### 必须上报的 run 产物

每次 run 至少产出以下 canonical artifacts：

- `crawl-run.json`
- `host-summary.json`
- `url-results.jsonl`
- `failures.jsonl`

这些产物必须支持：

- operator 审计
- 重放与排障
- ingestion 端判断新增 / 更新 / 删除观察结果

## 凭证与安全

`official_web` source channel 默认面向公开页面。

因此首版固定为：

- 无凭证公开抓取是默认路径
- 带凭证抓取是二期能力，而不是首版前置要求

如果未来接入凭证，必须满足：

- 凭证是 host-scoped，而不是全局万能账号
- 凭证只存在于 collector runtime 的 secret 注入面
- repo 只存 credential schema，不存真实密钥
- 凭证使用不会改变 collector “只上游采集、不下游写真相”的边界

## 与现有 document truth 的关系

`official_web` source channel 接入后，会影响多来源文档合并，但这件事的 ownership 在中心 ingestion，而不在 collector。

因此这里固定：

- collector 只提供 source observations 与 source-truth
- 不同来源是否合并为同一 `document_id + revision_track + version_id`，由中心 ingestion 判定
- primary source 的优先级继续由 revision-track-aware ingestion truth 决定
- `current-effective` 可以优先 `official_web`，但这不是 collector 侧规则

## 非目标

- 不在本文定义某个站点的 host allowlist
- 不在本文定义 sitemap、robots、参数 URL 或 search page 的处理细则
- 不在本文设计 HTML 正文抽取算法
- 不在本文引入新 retrieval 路由或新 specialist
- 不在本文授权 collector 直接写 serving 层真相

## 与其他文档的关系

- source channel 的站点边界与 URL admission：`docs/architecture/official-web-crawl-policy.md`
- source-truth 的 page/block schema：`docs/architecture/official-web-source-truth-contract.md`
- shared replay / rebuild boundary：`docs/architecture/source-truth-normalization-contract.md`
- 数据平面总架构：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- object storage key 约定：`docs/decisions/adr-0002-local-minio-conventions.md`

## 参考

- Kubernetes CronJob: https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
- Scrapy jobs / pause-resume: https://docs.scrapy.org/en/latest/topics/jobs.html
- Crawlee RequestQueue: https://crawlee.dev/js/api/next/core/class/RequestQueue
- Crawlee AutoscaledPool: https://crawlee.dev/js/api/3.2/core/class/AutoscaledPool

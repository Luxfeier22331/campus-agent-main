---
doc_type: architecture
status: active
created: 2026-03-22
updated: 2026-03-28
---

# campus-agent 第一阶段数据平面架构

## 文档边界

这份文档描述的是 `campus-agent` 在 phase-1 交付范围内的 `ingestion / storage / registry / chunk-index` 数据平面架构，不是 `.planning/ROADMAP.md` 中 “Phase 1: Contract And Boundary Guardrails” 的执行说明。

它只负责冻结跨 collection 共享的数据平面边界和不变量，不负责重复以下内容：

- 长期 package 边界和系统形态：`docs/architecture/long-term-architecture.md`
- 本机 `MinIO` / object key / bucket 不变量：`docs/decisions/adr-0002-local-minio-conventions.md`
- `student_handbook` 的 OCR 归一化、拆分和 document-level 语义：`docs/architecture/student-handbook-ocr-normalization-strategy.md`
- OCR/source-truth shared canonical contract：`docs/architecture/source-truth-normalization-contract.md`
- 长期版本化 serving / 历史查询目标：`docs/architecture/versioned-document-serving-and-history-query.md`
- collection 级 runtime truth：`configs/ingestion/<corpus>/<collection>/`
- gate、实施顺序和验收：`docs/plans/agentic-rag-foundation.md`

## 目标

第一阶段的数据平面目标是：

- 正式引入独立的 ingestion/data plane，而不是把数据导入继续塞进在线查询路径
- 从第一天起建立 `Raw -> Processed -> Chunk/Index` 分层
- 冻结 `single source consumption + multi-projection fan-out`，把 canonical 模型明确为 `raw -> source truth -> declared projections -> document/chunk/index`
- 用对象存储、raw asset registry、document registry 和 Qdrant 建立稳定真相源
- 让 retrieval 通过 `registry + qdrant` 返回可回链 evidence，而不是只消费向量库
- 保持 query path 与 offline ingestion path 分层，避免 supervisor/specialist 反向吸收数据平面细节

## Source Of Truth

当前文档体系的 ownership 固定如下：

- 数据平面的长期分层、package 边界：`docs/architecture/long-term-architecture.md`
- 第一阶段为什么采用对象存储 + registry + Qdrant：本文
- bucket、object key、registry 字段和迁移不变量：`docs/decisions/adr-0002-local-minio-conventions.md`
- `student_handbook` 的 source-level normalization 和 document-level cleanup truth：`docs/architecture/student-handbook-ocr-normalization-strategy.md`
- repo 级 source-truth canonical contract：`docs/architecture/source-truth-normalization-contract.md`
- `student_handbook` / `curriculum_plan` / `campus_services` 的具体 runtime 开关、chunk profile、split manifest：`configs/ingestion/`

换句话说，这份文档只保留跨 collection 的稳定架构约束；collection 专属规则不再在这里复制一份 runtime truth。

## 采用该数据面组合的原因

phase-1 当前采用对象存储 + raw asset registry + document registry + Qdrant，不是为了把实现堆得更重，而是为了尽早固定可重建、可审计、可升级的数据面骨架：

- 不把 ingestion 留成后续必须推倒重做的技术债
- 从第一天建立稳定的 `raw_asset_id`、`document_id`、`version_id` 与 `chunk_id`
- 支撑增量更新、删除、审计、回放与重处理，而不是只做一次性导入
- 让 retrieval 建立在 `registry + qdrant` 的可回链证据链之上，而不是只消费向量库分数
- 即使当前使用本机 `MinIO`，上层仍保持 `S3-compatible object storage` 语义，避免未来迁移云对象存储时重写 contract

## 架构结论

第一阶段采用如下数据平面：

- `Crawler / Job`
  负责采集或登记待摄入的原始来源
- `Queue`
  表达 ingestion 与上游采集的解耦边界；不在这里冻结为具体产品
- `Ingestion Worker`
  消费已登记的 raw asset，执行去重、版本推进、解析、chunking、embedding 写入
- `Object Storage`
  承载 raw 与 processed artifacts；当前阶段实现为本机部署的 `MinIO`，但架构语义始终是 `S3-compatible object storage`
  source bucket 内部固定采用单一 source prefix 下的 `capture -> provider -> source-truth` 阶段布局，而不是顶层 `pdf/`、`ocr/`、`source-truth/` 分裂布局
- `Raw Asset Registry`
  承载原始文件级真相元数据
- `Document Registry`
  承载逻辑文档级真相元数据
- `Qdrant`
  承载在线检索消费的 canonical chunk/index store
- `Retrieval Core`
  结合 registry 与 Qdrant 形成 evidence bundle，屏蔽下游实现细节

## 分层模型

### Raw Layer

职责：

- 保存 PDF、Word、Markdown、HTML 等原始来源文件
- 保留原始抓取来源信息与可重放输入
- 支撑审计、重处理和 provenance 回链

不变量：

- 使用对象存储，不以本机文件系统作为长期真相源
- 允许版本保留
- raw layer 不按 `corpus` 组织，因为同一份 raw asset 可能被多个 corpus 复用

### Raw Asset Registry

职责：

- 保存 `raw_asset_id`、`raw_version_id`、`content_hash`、`source_filename`、`raw_source_uri`、`object_key`
- 表达“这份原始文件是什么”
- 保证同一份 raw 资产不会因为拆出多个逻辑文档而被重复登记为多个原始真相

不变量：

- raw 文件身份不绑定到 `document_id/version_id`
- retrieval 和 document registry 只能通过显式引用回链 raw asset，不能从 object key 反推真相

### Processed Layer

职责：

- 保存清洗文本、OCR/解析结果、供应商原始响应、结构化中间结果
- 作为 chunk 的可重建来源
- 为不同 collection 提供稳定的 source-level 和 document-level artifact 边界

不变量：

- processed 必须能从 raw 重建
- processed 可以承载中间结果，但不是在线查询的 canonical chunk store
- processed layer 按长期知识域 `corpus` 组织
- source-level artifact 与 document-level artifact 必须分层保存，不能互相替代

### Source Truth 与 Projection Boundary

第一阶段对可复用 source asset 的 canonical 模型固定为：

`raw -> source truth -> declared projections -> document/chunk/index`

这里的 `source truth` 指的是已经脱离 provider 私有形状、可稳定重放的 source-level truth，例如 handbook 的 `layout-elements.jsonl`、split truth 与 per-document source rows；它是后续 document build、attachment projection、service projection 与 replay/rebuild 的唯一共享上游。其 repo 级字段与命名 contract 以 `docs/architecture/source-truth-normalization-contract.md` 为准。

职责：

- 把一份 raw source 消费一次，并把可重放的 source truth 持久化一次
- 以 repo-tracked projection declaration 显式声明该 source 会 fan-out 到哪些下游 document family、collection 或 attachment-like output
- 让后续 replay/rebuild 直接从 persisted source truth 重新生成 document artifact、chunk/index 或 derived document，而不是重新回到 raw

不变量：

- 同一份 canonical source truth 已存在时，后续 collection 扩展、附件抽取或派生文档生成不得返回 raw 重新消费；do not return to raw
- 允许一个 source asset fan-out 到多个 collection/corpus，但 fan-out 必须通过显式 projection contract，而不是“每个下游 collection 再跑一条独立 raw ingestion lane”
- attachment、appendix、form、navigation-like leaves 只要具有独立下游价值，就应作为 explicit derived document 建模，并保留对 source truth 与 parent document 的稳定 provenance
- projection contract 只属于 ingestion/data plane；它不改变 retrieval、supervisor 或 contracts 的边界

当前明确要被替换的反模式：

- handbook-only replay：把 replay/rebuild 绑定成 `student_handbook` 私有支路，而不是 replay from source truth
- separate `campus_services` migration lane：把 handbook-derived service output 建成独立迁移世界观，而不是同一 source truth 下的 declared projection
- attachment semantics trapped inside cleanup：附件/附录/表单/导航语义只存在于清洗逻辑里，而不落成 derived document

### Document Registry

职责：

- 保存 `document_id`、`revision_track`、`version_id`、`source_uri`、`content_hash`、`corpus`、`collection`、ACL、状态、时间戳，以及指向 raw asset 的引用
- 表达“当前逻辑文档版本是什么”
- 支撑增量更新、删除、审计、retrieval 前过滤与 evidence 回链

不变量：

- document registry 只登记逻辑文档，不重复承载 raw 文件身份
- registry 字段必须显式存储，不允许把 object key 命名当成 registry 替代品
- `source_uri` 表达 document-level canonical locator，不要求等于外部官网 URL

### Chunk / Index Layer

职责：

- 保存在线检索所需的 chunk 文本、chunk metadata、embeddings 和向量索引
- 为 retrieval 提供 evidence 选择的主消费面

不变量：

- 第一阶段 canonical chunk store 是 `Qdrant`
- 每个 chunk 必须回链到 `document_id`、`revision_track`、`version_id`
- 已进入 release-managed lifecycle 的 collection 必须通过固定 serving alias 暴露，离线重建写入按 `collection_prefix__release_id` 命名的 versioned physical collection
- 每次 chunking/embedding/indexing 发布都必须生成小型 release manifest，并落到 derived bucket 的 `{corpus}/releases/{collection}/{release_id}/` 前缀；manifest 用于审计与回滚，不保存 chunk dump
- embedding request contract 与 Qdrant schema contract 必须分离：
  `model` / `dimensions` 属于 embedding runtime；
  named dense/sparse vectors、payload metadata 与 hybrid query shape 属于 Qdrant collection schema
- `student_handbook` 的 accepted target schema 是同一点双写 named `dense` 与 named `sparse` vectors
- 对象存储不保留 chunking 后的全文 chunk 产物；chunk 文本、向量与检索 payload 只保留在 Qdrant 中，离线重建以 `document-units.jsonl + policy version` 为准

## 第一阶段固定流程

### 摄入链路

`crawler/jobs -> raw layer -> raw asset registry -> ingestion worker -> source truth -> declared projections -> document registry -> qdrant`

固定规则：

- crawler 产物先进入对象存储和 raw asset registry，不直接把本机路径当长期数据源
- ingestion worker 通过 `raw_asset_id + raw_version_id` 消费已登记 raw asset，而不是直接消费本地文件路径
- ingestion worker 对同一 source asset 的 canonical raw/source truth 只消费与持久化一次；后续 fan-out 通过 declared projections 执行
- 对需要 online retrieval 的 collection，rebuild/indexing 必须对同一 `chunk_id` 同步写入 dense 与 sparse vectors；不能只重建 dense 而让 sparse 留在在线临时计算路径
- 去重在摄入早期完成
- 无变化文档直接 skip；有变化文档生成新 `version_id`
- 文档删除通过 registry 状态与索引删除同步处理
- replay/rebuild 的 canonical boundary 是 persisted source truth，而不是 handbook-only branch、legacy migration side path 或二次 raw re-entry
- handbook-derived `campus_services` output、attachment/form/navigation-like output 都必须从 source truth fan-out，而不是各自回到 raw
- `curriculum/curriculum_plan` 的 accepted ingestion path 固定为 `source-truth/layout-elements.jsonl -> split-manifest logical documents -> source-truth-preserving document-units.jsonl -> curriculum_plan_semantic_v1`
- collection 专属 normalization、cleanup、chunking 规则由对应 strategy doc 和 `configs/ingestion/` 冻结，不在本文重复

### 查询链路

`supervisor api -> supervisor core -> rag specialist -> retrieval core -> qdrant + registry -> evidence bundle`

固定规则：

- query-serving surface 由 collection runtime profile 控制；当前 query-enabled collection 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- `campus_services/service_catalog` 与 `campus_services/contact_directory` 当前保持 `offline_preparation`，不进入默认 query-serving surface；但它们已经可以参与 release-managed index lifecycle，并应与 query-serving collection 一样使用稳定 alias + versioned physical collection
- retrieval 返回的 source 必须能回链到 document registry
- retrieval 前置 ACL filter 必须基于 metadata 执行
- 当前 retrieval accepted baseline 为 `dense + sparse hybrid retrieval + RRF fusion + registry-backed evidence shaping`；`HyDE` 和 rerank 不是默认主路径
- 当前 handbook embedding runtime 通过 `gitee` 官方 OpenAI-compatible 接口请求 `Qwen3-Embedding-4B @ 2560`，ingestion 与 retrieval query path 都必须显式发送 `dimensions=2560`
- 当前 handbook dense query embedding 会在 retrieval time 追加英文 instruction，再送入 `Qwen3-Embedding-4B`
- 当前 handbook 的 phase-1 sparse baseline 先采用 `Qdrant native BM25`，并以 `tokenizer=multilingual`、`language=none` 作为中文 handbook 起始配置
- 当前 handbook 的 accepted target retrieval shape 是 Qdrant native hybrid query：同一 filter 下执行 dense prefetch 与 sparse prefetch，并使用 native `RRF` 融合；当前 runtime 冻结为 dense prefetch `20`、sparse prefetch `20`、`RrfQuery(k=60, weights=[1.0,1.0])`
- query-serving 默认只消费 collection runtime profile 定义的 serving documents。当前 `student_handbook` 策略为 `current_only=true` 且 `serving_revision_tracks=["current-effective","source-faithful"]`；当前 `curriculum_plan` 策略为 `current_only=false` 且 `serving_revision_tracks=["source-faithful"]`
- 当前 `student_handbook` runtime profile 默认返回 `8` 个 retrieval candidates，回答阶段再裁剪为最多 `3` 条支撑证据
- query path 不再接受“历史版本先命中，再靠 `latest_url` 告知用户当前链接”作为默认主路径；历史版本默认不进入 retrieval candidate
- 当同一逻辑文档同时存在 `pdf_ocr` / `official_web` 等多来源且规范化内容一致时，source layer 保留多份来源资产，但 document/version layer 只保留一份逻辑版本；Qdrant 不得为等价来源重复建索引点
- 当前数据平面已经具备“保留历史版本并维护 current truth”的能力，但当前在线 query path 仍不支持用户显式选择历史版本、按时间点查询或版本对比；这些属于后续版本化 serving 能力，不属于本文冻结的现状

## 去重与版本策略

第一阶段采用：

- exact duplicate: `content_hash`
- stable identity: `document_id`
- semantic representation line: `revision_track`
- mutable version: `version_id`

规则：

- 同一 `document_id` 且 `content_hash` 不变：跳过重处理
- 同一 `document_id` 且 `content_hash` 变化：生成新 `version_id`
- ingestion 必须维护 `document_id + revision_track` 维度的 current truth；新 current 版本写入时，旧 current 必须同步降级为 `is_current=false`
- 如果不同来源在同一 `document_id + revision_track` 下产生相同规范化内容，则必须复用已有 `version_id`，并把来源差异落到 provenance，而不是再生成第二条 document registry record
- `chunk_id` 基于 `document_id + revision_track + version_id + chunk_order`

## ACL 与 Traceability

第一阶段必须做到：

- 文档级 ACL metadata
- chunk 级 ACL metadata 继承文档 metadata
- retrieval/evidence 返回最小 source locator 字段
- ingestion 和 query 都写结构化日志
- object storage 路径从第一天起保持稳定语义，避免未来迁移云对象存储时重写数据面规则

第一阶段不做到：

- chunk-level field masking
- 完整 ABAC policy engine
- 不可变审计账本

## 与仓库结构的对应关系

- `apps/ingestion-worker`
  ingestion runtime 壳，承接 raw ingestion / rebuild 等 worker 入口
- `packages/ingestion-core`
  去重、解析、cleanup、chunking、embedding、registry 写入的逻辑层
- `packages/retrieval-core`
  基于 registry + Qdrant 的 retrieval abstraction
- `packages/contracts`
  document / chunk / evidence 相关共享 schema，不泄漏基础设施类型

## 这份文档不再承载的内容

以下内容如有变化，应更新对应 source of truth，而不是先改本文：

- handbook 的 `provider-response -> layout-elements -> split-manifest -> canonical.md -> document-units.jsonl` 细节
- handbook / curriculum 的 unit set、chunk policy、cleaning policy、revision_track 默认值
- bucket 名、object key 展开规则、迁移不变量
- 任何 collection 级 runtime 开关或 profile 参数

## 当前实现入口

- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry.py`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`

## 第一阶段不做的事

- 不做旧 `/api/search`、`/api/answer` 兼容层
- 不做本机目录长期存储
- 不做多 backend 并行
- 不让 collection 专属 runtime truth 散落到多个 architecture doc 中

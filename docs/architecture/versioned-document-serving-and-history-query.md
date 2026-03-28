---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Versioned Document Serving And History Query

## 文档边界

本文只负责冻结 repo 对“版本化文档服务”和“历史版本查询”的长期目标形态。

它回答的是：

- 为什么不能因为默认服务最新版就删除历史版本
- 为什么普通查询默认只消费当前有效版本
- 当用户明确要查旧版、按时间点查或比较新旧版时，系统长期应该怎样工作

它不负责：

- 当前 retrieval baseline 的 dense/sparse/fusion 细节
- source-truth、chunking、embedding 的 collection-specific 规则
- 当前某个 collection 是否已经开放历史查询

当前运行现实仍以：

- `docs/architecture/retrieval-query-strategy.md`
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `docs/verification/phase1-ingestion-retrieval-implementation-truth.md`

为准。

## 核心结论

- 历史版本必须保留；“默认服务当前有效版本”不等于“删除历史版本”
- 普通 query-serving 默认只消费当前有效版本
- 历史版本查询必须是显式能力，而不是让模型仅凭 query 自行猜测要查哪一版
- 版本选择必须发生在 retrieval 之前，而不是命中历史内容后再由回答层补救
- 多来源等价内容应归并为一个逻辑版本，不得以多个来源副本形式同时进入候选集

## 长期目标形态

长期查询形态固定拆成四类：

### 1. Current Query

默认模式。

行为：

- 只查当前有效版本
- 只消费当前 serving surface 允许的逻辑版本
- 不把历史版本作为普通问答的候选集

适用：

- 普通“现在怎么规定”“目前怎么办”类问题

### 2. Historical Query

显式历史模式。

行为：

- 用户指定历史版本、年份、修订批次或明确表达“旧版/以前”
- query path 只在指定历史范围内检索
- 回答必须显式标注“以下内容基于历史版本，非现行规定”

适用：

- “2021 版怎么写”
- “旧版学生手册如何规定”

### 3. As-Of Query

时间点模式。

行为：

- 用户给出一个时间点，例如“2022 年 9 月当时的规定”
- 系统先解析该时间点对应的有效版本
- retrieval 只在该时间点有效的版本范围里执行

适用：

- “某年某月当时生效的规定是什么”

### 4. Compare Query

版本对比模式。

行为：

- 同时解析两个版本或两个时间点
- 分别检索，再执行 compare-style 回答组装
- 输出必须明确区分旧版、新版与变化点

适用：

- “新版和旧版差别是什么”
- “2021 版和现行版相比改了什么”

## 版本选择边界

长期查询链路中，必须显式存在一层：

`user request -> version selection -> version resolution -> retrieval -> evidence shaping -> answer assembly`

其中：

- `version selection`
  负责判断当前 query 属于 current、historical、as_of 还是 compare
- `version resolution`
  负责把用户意图解析成可检索的版本范围，例如具体 `version_id`、时间点有效版本或比较双方

这层职责不属于：

- vector store
- answer generator
- LLM 自由推断

## Registry 的长期职责

长期形态下，`DocumentRegistry` 不只是“记录版本元数据”，还必须承担版本解析职责。

至少要能回答：

- 某逻辑文档的当前有效版本是谁
- 某时间点生效版本是谁
- 某版本是否已被替代
- 两个版本是否属于同一演进链
- 同一版本有哪些 primary / alternate source

因此长期 registry truth 至少要稳定表达：

- `document_id`
- `revision_track`
- `version_id`
- `is_current`
- `status`
- `effective_from`
- `effective_to`
- provenance / primary source / alternate source

## Retrieval 的长期边界

retrieval 长期仍然只负责：

- 在给定版本范围内做候选召回
- 结合 metadata filter 做前置过滤
- 返回 registry-backed evidence

retrieval 不负责：

- 自行判断用户是不是想查旧版
- 先查全量再由回答层事后丢弃历史版本
- 把多个等价来源作为多个独立证据喂给下游

长期固定规则：

- 版本过滤必须在 retrieval candidate 阶段完成
- current / historical / as_of / compare 都必须先解析版本范围，再进入检索

## 回答层的长期语义

不同版本模式下，回答语义必须不同。

### Current

- 正常回答

### Historical

- 明确提示“历史版本”“非现行规定”

### As-Of

- 明确提示“基于某时间点当时有效版本”

### Compare

- 明确输出旧版、新版与差异点

禁止：

- 把历史版本答案包装成现行规定
- 在 compare 场景中只返回单边内容

## 多来源归并

长期形态固定如下：

- `pdf_ocr`、`official_web`、`manual_curated` 等来源属于 source/provenance 维度
- retrieval / serving 消费的是逻辑 document version
- 同一逻辑版本的多来源必须归并，而不是重复索引、重复命中、重复引用

允许：

- source layer 保留多份来源资产
- registry 记录 primary source 与 alternate source

不允许：

- 在 retrieval candidate 中把等价来源表现成多个独立 evidence

## 当前现状与长期目标的关系

当前 repo 已经具备：

- 保留历史版本
- 维护 current truth
- 默认只服务当前有效版本
- 多来源等价内容归并到同一逻辑版本

当前 repo 还不具备：

- 用户显式指定历史版本查询
- 按时间点查询
- 版本对比查询
- 独立的 version selection / version resolution 运行时边界

因此当前现状是长期目标的子集，而不是长期目标已经完成。

## 与其他文档的关系

- 当前 retrieval 运行现实：`retrieval-query-strategy.md`
- 当前数据平面与 version truth：`phase1-ingestion-and-storage-architecture.md`
- 已接受规则：`../decisions/adr-0014-versioned-document-serving-and-history-query.md`
- 后续实施拆解：`../plans/versioned-history-query-foundation.md`

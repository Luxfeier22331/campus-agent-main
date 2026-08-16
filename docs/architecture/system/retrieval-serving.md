---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---

# 检索服务

## 边界

本文定义 Campus Web 文档如何形成不可变检索索引，以及 execution-control 如何准入和查询该索引。
它不负责来源采集、文档清洗、Campus Web 页面构建、答案生成或通知检索。

当前检索链只消费已经交付给 Campus Web 的公开文档，直接读取当前 reader，并把所有文档发布为
一个不可变 collection 和一个 PostgreSQL 当前索引绑定。

## 输入所有权

对象存储固定键 `campus-docs/source.json` 保存规范化的 `campus_docs_source.v3` 控制清单。清单负责：

- 列出公开文档及其唯一当前版本；
- 把 `docId`、`versionId`、公开目录和 reader 对象关联起来；
- 用 `key`、`byteSize` 和 `sha256` 固定 reader 对象身份。

`source.json` 不是可检索正文。发布器消费它，是为了和 Campus Web 使用同一份当前版本选择，并在读取
reader 前核对对象身份。真正进入检索索引的正文只来自清单引用的当前
`campus_docs_reader.v3`。历史版本、课程图和其他补充资产不进入在线索引。

`source.json` 表达完整当前期望集合，不是增量补丁。新增、修订和删除都先形成新的完整清单；bucket 中
未被清单引用的对象不会被 publisher 自动发现或索引。

这一输入已经包含文档站需要的稳定文档、版本、章节锚点和正文结构，因此检索发布器直接按 reader
元素形成 section 和 chunk。通知仍在独立采集设计中，不是当前 publisher 的输入。

## 索引定义

publisher 代码内的 `INDEX_DEFINITION` 固定 reader/source schema、分块算法、embedding space ID、
dimensions、查询指令、point schema、向量名和本地 sparse 算法。provider、endpoint、API key 和
provider-specific model alias 是连接属性，不参与索引身份。execution-control 从当前索引绑定取得
实际查询字段，不加载第二份索引配置。

collection 名由 `campus_docs_index.v1` manifest 的规范 JSON SHA-256 形成：
`campus_docs_<manifest-sha256>`。manifest 引用显式 chunk set、embedding set、`INDEX_DEFINITION`、
point 数和当前文档投影摘要。当前文档投影只包含每份当前文档的目录、身份、公开 slug、标题、当前
版本和 reader 对象引用；历史版本、redirect、topic 描述和清单 JSON 格式不参与。manifest 摘要同时
是对象存储制品 ID 和 collection 后缀，不维护第二套数据库索引身份。

当前 sparse 向量使用 `fnv1a_log_tf.v1`：`unicode_word_v1` 分词、`und` 语言标签下的 Unicode
小写映射、FNV-1a 32 位索引和 `log1p(term frequency)` 权重；Qdrant 对 named sparse vector 应用
`idf` modifier。publisher 与在线查询端使用固定用例验证同一实现。

### 分块规则

当前 `campus_docs_reader_elements.v3` 使用 Unicode 字符数，不依赖模型 tokenizer：软目标为 800
字符，单个 chunk 硬上限为 1600 字符，不做通用重叠。

- heading 只维护按 level 收敛的完整标题路径，不进入 evidence 正文，也不单独生成 point；没有正文的
  heading 会被省略，子章节仍继承有效父标题；
- 标题前正文属于 preamble，`section_ref` 使用当前版本的 `/v/<versionSlug>` 固定链接，不生成伪锚点；
- paragraph、list 和 blockquote 保持 reader 元素完整，按原顺序贪心合并到 800 字符；单元素在
  801 至 1600 字符之间时保持完整，超过 1600 字符时优先在 800 至 1600 字符间的自然边界切分，
  边界优先级依次为空行、列表项、句末标点和子句标点，没有边界才在硬上限切分。ASCII `.` 位于
  Unicode 字母或数字之间、或后面仍是 `.` 时不作为边界；ASCII `,`、`:` 位于两个数字之间时也不
  作为边界，避免拆开小数、千分位、时间、域名和版本号；
- table 不与普通正文合并。publisher 展开 `rowSpan`、`colSpan` 时保留物理单元格身份，再按完整逻辑
  行分块；开头连续语义表头行形成多级列路径。`colSpan` 值每行只输出一次，`rowSpan` 正文上下文在
  每个覆盖行输出一次，相邻同值单元格合并值并合并列路径，空值省略；没有表头时按非空物理值的阅读
  顺序输出，不生成通用列名。全表只有表头，或部分表头列没有任何非空数据时，仍保留对应的非空表头
  文本。单行超过硬上限时先在 field 边界拆分，单 field 超限时再使用普通正文的结构边界；
- chunk 的 `root_unit_ids` 按正文元素首次出现顺序去重，覆盖该 evidence 实际包含的全部 reader 根单元。

字符硬上限之外仍保留 16000 UTF-8 byte 传输限制；它不参与正常分块目标。

point 中的 `text` 是可交给 Agent 和来源卡片的 evidence 正文。point v3 保存版本 ID、版本 slug、
版本标签以及该版本的公开 `section_ref`。dense embedding 和 sparse vector 使用
`retrieval_text`，其内容依次为文档标题、完整 heading 路径和 evidence 正文；标题上下文不混入引用
片段。point 分别保存 `text_sha256` 和 `retrieval_text_sha256`，不保存字符数。

## 发布流程

```text
Chunk Job: source.json + 当前 reader -> chunk set manifest + chunks.ndjson
Embedding Job: 显式 chunk set + 一次性 provider snapshot -> embedding set manifest + embeddings.ndjson
Publisher Job: 显式 chunk set + embedding set -> index manifest -> campus_docs_<manifest-sha256>
-> 写入并全量校验 Qdrant points
-> 重新读取 source.json，确认当前文档投影未变化
-> 原子替换 campus_docs_serving.current_index 单行绑定
```

三个阶段都由人工独立触发，不自动串联，也不维护 `latest` 制品指针或构建状态机。manifest 和 NDJSON
使用规范序列化、最终换行和内容寻址对象键；不可变写入采用 create-or-verify。只有会影响 index
manifest 的输入变化才产生新 collection。section、chunk 和 Qdrant UUID point ID 也由稳定输入确定。
每个 point payload 只保存 schema、chunk、document、section、
版本 ID/slug/label、`root_unit_ids`、公开 `section_ref`、正文、正文 SHA-256 和检索文本 SHA-256，
并带 dense/sparse named vector。publisher 不把对象存储地址、凭据、原始来源文件、endpoint 或
`embedding_space_id` 重复写入 point。

激活前校验包括 collection 的 dense 维度与 `Cosine` distance、sparse `idf` 配置、精确 point 数，
并分页读取全部 point，核对精确 ID 集合、payload、dense vector 和 sparse vector。构建或末次输入
核对失败时删除尚未激活的新 collection，当前绑定保持不变。
进入数据库激活后，即使调用方收到不确定错误，也保留已验证 collection，避免误删可能已经激活的
索引。

Embedding Job 只从显式 `--reuse-embedding-set` 读取候选向量，并以
`embedding_space_id + retrievalTextSha256` 作为复用键；同一新检索文本只调用一次 provider。
Qdrant 不再作为 embedding 复用缓存。Publisher 从 chunk set 重新生成全部 payload 和 sparse vector，
并从 embedding set 取得 dense vector，因此每次成功发布仍得到完整的新 collection。

PostgreSQL session advisory lock 只保证同一时间只有一个 Publisher。未激活目标 collection 已由中断
任务完整写入时，重跑会验证并激活；确定性内容不匹配时删除重建；Qdrant 请求错误不触发删除。目标
已经是当前绑定时仍完整校验：物理 collection 缺失则原名重建，已存在但内容不匹配则停止且不删除。
环境通过三个保持暂停的 CronJob 模板分别创建一次性 Job，不运行定时索引任务。

## 激活读取模型

PostgreSQL `campus_docs_serving` 只保存 `current_index` 单行绑定，包含当前 collection、dense
向量名、embedding dimensions/query instruction/space ID，以及 sparse model/vector name。
publisher 在事务内插入或更新该行；execution-control 只有读取权限。数据库不保存索引历史、来源
摘要、构建计数或重复的不可变索引记录。

数据库角色 `campus_docs_index_publisher` 只有 schema `USAGE` 和当前绑定表的
`SELECT/INSERT/UPDATE`；它不能创建或删除表，也不能删除当前绑定行。

在线请求不跟随 Qdrant alias，也不从浏览器或模型接收 collection。旧 collection 不在新索引激活后
立即删除，因为已准入 run 仍持有旧快照；仓库当前没有自动清理或保留期状态机。

文档更新不会原地修改向量。来源维护者先更新 reader 和 `source.json`，publisher 再构建新的完整
collection，验证后原子替换当前绑定。切换前创建的 run 继续使用已冻结旧 collection，切换后创建的
run 使用新索引。仅修改历史版本或未被当前清单引用的对象不会改变当前 collection 身份。

## 在线准入与查询

每个有效请求都在 workflow 创建前读取当前索引绑定。准入快照冻结物理 collection、dense/sparse
向量名、embedding dimensions/query instruction/space ID、sparse model、本轮查询 hash 和 embedding
Provider Config 的非敏感 hash。当前 embedding 设置只保存 provider、Base URL、model、固定
`embeddings` transport 和加密 API key；完整配置仍被 hash 固定，保证单次请求内连接不变化。索引
维度与 space ID 不重复写入模型设置。缺少当前绑定或 Embedding 设置时拒绝准入。

`RetrieveCampusDocsEvidenceActivity` 使用 `Instruct: <instruction>\nQuery:<query>` 构造 Qwen3 dense
查询文本，以已准入索引 dimensions 调用当前 provider，并校验返回向量长度；同时对原问题生成同算法
sparse vector。sparse 非空时向冻结 collection 的 dense 和 sparse
查询各预取 24 个候选，再由 Qdrant RRF 返回最多 24 个 point；纯符号等无法生成 sparse token 的合法
问题直接执行 dense 查询，不进入第二条检索链路。返回 point 的正文摘要、固定版本 section 引用、
版本字段、根单元数组和必需字段必须有效；随后按 Qdrant 查询分数顺序单次扫描并去重 chunk，超过
剩余字符预算的候选会被跳过，继续检查后续候选。最终最多 8 条
evidence、合计最多 4000 个 Unicode 字符；不再按 section 重排。字符数由正文现场计算，不依赖 point
计数字段。任一依赖或校验失败都失败关闭，不回退旧绑定、缓存、其他 collection 或模型记忆。

## 当前限制

- 只索引 Campus Web 清单中的当前 reader，不支持通知或实时网页搜索；
- 不提供历史版本、指定日期或用户选择版本的在线检索；
- 不执行模型查询改写、模型路由、外部 reranker 或迭代检索；
- Qdrant 查询分数只用于候选排序，不表示答案正确性或充分性；
- publisher 可运行不表示任一环境已经存在当前索引，环境状态需由实际数据库和发布任务确认。

## 相关文档

- [Agent 知识读取](agentic-retrieval.md)
- [文档站架构](document-site.md)
- [文档阅读器数据模型](../../data/document-reader.md)
- [持久运行数据](../../data/durable-runtime.md)
- [Campus Docs 维护与索引发布](../../runbooks/campus-docs.md)

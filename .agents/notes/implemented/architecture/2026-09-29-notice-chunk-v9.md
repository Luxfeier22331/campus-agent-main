# Agent Note: 通知分块 v9/v10 与完整证据发布

Status: implemented

## 背景

2026-09-29 围绕 #562，在基线 `f312f0691` 的 2,845 篇已发布非空通知中确认了 19 篇关系缺陷：
字段标签与值分离、日期与时段分离、项目限定条件丢失、秋季章节挂在春季下，以及分号表续块缺少列名。
v8 的原文覆盖和长度检查全部通过，说明这些检查不足以证明返回证据可正确解释。

统一 publisher 当时以 `retrievalText` 构建向量，却将 `content` 写入 Notice point `text`。
检索上下文因此没有完整传递到重排和模型。消费端 Notice 校验还只接受 point v1，而 publisher 已输出 v2。

本篇部分取代[通知结构分块 v8](./2026-08-31-notice-chunk-strategy.md)中字段分组、父项上下文和证据发布的选择；
保留正式章节隔离、合法短块、原文可追溯、固定题集比较和不使用固定窗口 overlap 的原则。
规则合同由[通知数据](../../../../docs/data/notices.md#检索分块与制品)维护。

## 决策

### 原文归属与长度

`notice_text_structure.v9` 继续使用 `content_text`、800 字目标和 1,200 字硬上限。
沿用 SourceLine、SemanticUnit、UnitPiece 和 ChunkPart，不新增解析框架、模型调用或序列化字段。

- 正式标题的括号备注与主干分别判断；备注含逗号不取消标题。短名词型“报送时间及形式”
  可成为标题，完整指令继续作为正文。
- `No.N`、批次、日期时段和条件父项形成局部范围；同级项结束前项。局部父项保持在原文正文中，
  续块带完整原文上下文，不伪装为正式 headingPath。
- 冒号与 `【标签】` 绑定后续值，同级标签开启新组，不依赖空行；时间冒号和 URL 不开启字段。
  普通文字后的阿拉伯列表也识别边界，独占一行的序号继续绑定正文。
- 分号表要求明确列名、至少三列、等列数及连续序号行，保留真实列顺序。表头只作为检索和证据上下文。
  不把一般分号叙述猜成表格，不补造列名。
- 超长单元预留必要上下文的预算，再切正文；字段续块保留标签，人物续块保留原文姓名，
  可移动的尾部独立标签随值进入下一块。不同父项的上下文阻止错误组合。

新增规则的 owner 是 notice-index-publisher，消费者是统一 publisher 和 campus_search。
它们直接对应已观察关系缺陷；如果未来正文投影提供显式结构，应重新评估这些纯文本识别规则。
本轮没有增加固定 overlap、邻块扩展、备用检索路由、数据库字段或发布门禁。

### 证据传递

2026-09-30 扩大采样后，当前 builder 升至 `notice_text_structure.v10`，继续使用上述长度和制品字段。
四篇新增真实通知分别暴露阶段日期串用（356776）、普通文本续块错误继承首行标签（248133）、
报告题目与报告人/时间拆散（246044）、跨正式组别的赛道资格丢失（356868）。采用以下局部修复：

- 标题主干的冒号判断排除括号时刻；带明确日期的短材料提交阶段可成为标题。保留完整指令、负责组织
  等排除规则，避免仅凭“材料”结尾就提升标题并污染后续同级项。
- 普通 text 单元不继承首行字段标签；同一原文行跨块仍保留该行标签，field、list-item 和 record
  保留已有续块语义。防止多个长段落组成的单元跨过同级标签后，仍补入第一段的标签。
- 报告题目后出现报告人、报告时间时复用 record，按报告边界隔离；超长报告保留题目作为续块上下文。
  不把逗号编号一般化为所有列表的标记，也不强求超过预算的整场报告保持单块。
- 分组引导语的作用范围在正式章节切分时保留，继承给后续组别的 retrievalHeadingPath；新分组清除旧组别，
  新一级章节结束该范围。不把赛道通用资格伪装成正式 headingPath，不新增外部 schema。

### 证据发布合同

`content` 继续保存该块负责覆盖的原文，来源范围和非换行字符覆盖仍基于它。
`retrievalText` 首行为通知标题，其余是正式章节、必要局部父项、表头和正文。
统一 publisher 将首行之外的内容写入 Notice point `text`，并据此计算 `text_sha256`。
上下文与正文合计不超过 1,200 个 Unicode 字符；标题已有独立字段，不重复计入证据正文。

统一 point 使用 `campus_rag_point.v3`，完整证据与来源发布时间共同进入发布合同；本地 Chunk Run 使用 v2。
execution-control 接受 Notice v1/v2/v3，Docs v3 延续 v2 的路由字段校验。
本地数据检查同步接受 point v3；seed 更新至 v9 Chunk Run 和 Embedding Set，
正文与向量未变，复用已提交的向量数据。
已有结果选择保持最多五条和 4,000 字总预算，超预算时跳过整条，不截断证据。

部署顺序为 execution-control 消费兼容、v9 builder/统一 publisher、生成制品并激活候选。
激活仍走既有 collection 校验、current/previous 和回滚流程；发现事实归属错误、必要证据丢失或
消费不兼容时，按既有“暂停并回滚至上一版本”处理，同时暂停或恢复 producer，防止刷新覆盖回滚。

### 现存制品读取

已有 Docs Embedding Set 可能沿用切换 UTF-16 排序之前的英文 ICU 排序，
例如 `embeddings` 位于 `embeddingSpace` 之前；读取端必须兼容这一既有制品格式。

统一 publisher 的 manifest reader 接受这一确定的旧排序：Docs 使用原有双空格缩进，Notice 使用紧凑格式。
兼容读取显式固定英文 locale，写入继续使用当前 canonical-order；不重写已有制品或改变其内容身份。
摘要、schema、数据引用、字节数和数量校验继续生效。消费者为本地数据导入和统一发布，owner 仍是统一 publisher。
当所有可激活集合不再引用这些制品时，可删除旧排序读取；本次未扩大为任意 JSON 格式接受。

### 身份与摘要清理

后续 hash 审查确认：chunkId 混入算法版本和整篇来源摘要，使局部改动扩散到全篇 ID；生产
Embedding Set 又引用包含审查报告的 Chunk Run，使诊断变化影响 collection 身份。与此同时，
收集文本后 resolver 再算一次摘要，排序 comparator 也重复计算同一候选的排名。

Chunk 定位改为 `notice:<noticeId>:<chunkIndex>`，只承诺同一数据集内的位置；不把它当作跨版本
内容身份。删除整篇 source 摘要和基于算法/范围的 chunkId hash。模型 target 与 retrievalText
摘要继续决定向量缓存，实际 serving NDJSON 字节决定 chunks 对象；`notice_embedding_set.v2`
直接引用 chunks，不再引用审查 Run。collection 继续绑定两个 set ID，不改 catalog 合同。

本地 `notice_chunk_run.v2` 保留算法定义、review、validation 和 chunks，用于审查与评测；生产
只写 chunks 数据。两次 schema 升级对应定位 ID 合同和 manifest 引用结构变化，不是因删除重复
hash 而升级版本。builder 算法仍为 v10，embedding space、cache schema 和 point schema 不变。
既有 v1 set 的读取保留在统一 publisher 和清理器中，支持 current/previous 引用；当可激活
版本不再引用 v1 后可删除这一读取分支。清理继续保护共享 chunks，新增 chunk-data 删除权限。

每个 embedding 操作按原文去重后只算一次文本摘要，传递给 resolver/cache import；评测与抽样
复用同一结果。Notice 确定性排名在 sort 前计算，排序合同不变。内容寻址、持久幂等、HMAC 和
真实存储读取后的完整性核验仍有消费者，本轮保留；不增加跨请求 hash 缓存或统一 hash 框架。

### 发布时间与完整证据的组合

[通知发布时间证据](../bug-fix/2026-09-30-notice-publication-evidence-and-relative-years.md)要求 Notice point v3
携带真实发布时间。本分支保留 v10 分块、位置型 chunkId 和 `notice_embedding_set.v2` 直接引用 chunks，
同时从数据库快照经 `releasedAt` 传递到 point 的 `released_at`。发布时间不进入 `retrievalText`，
因此仅增加日期不会重算向量；chunks 字节及其 set 引用随 metadata 更新。

统一 publisher 的 `text` 仍为标题之后的完整检索证据，不能用纯正文覆盖；跨端 fixture 同时校验
位置型 ID、章节上下文、证据摘要和发布时间。本地 seed 使用相同 builder 生成带日期的 chunks，复用既有向量。

旧 Chunk Run v1/v2 仍可读取，但缺少真实 `releasedAt` 的制品不能重新发布为新版 point v3。
新发布需从来源重建带日期的 chunks。Ops 发起回滚时固定已验证的 previous collection 与 expectedCurrent，
经 workflow/activity 交给统一 publisher 的 rollback runner；runner 取得既有发布锁后直接调用 catalog 激活，
不读取制品、不重组 points，也不访问 Qdrant。重试复用固定目标，沿用 catalog 的 no-op 和 obsolete 语义，
不根据重试时的 previous 重新选取目标。collection 原有 producer 与制品引用保持不变。
不补造日期，也不把旧读取测试改成已带日期的样例来声称无日期制品可以重发布。

### 执行链摘要复用

工具合同直接比较完整字段；内存 payload/evidence 相等比较使用 JSON 字节。admission 摘要和
Hindsight bank/document ID 在单次操作内复用；Owner/Subject HMAC 委托已有 memoryruntime，
删除无消费者 lifecycleErrorHash。持久幂等和真实读取后的摘要验证保留，未改变外部摘要值。
受影响 execution、admission、reconciler、Hindsight 和 Temporal 包测试通过。

### 工具脚本摘要清理

Campus Docs 与题集抽样在 sort 前计算每个候选的确定性排名，保留原排序合同。地图制品
直接比较文件字节；随机 eval 使用带前缀 UUID，保留需要重复发布去重的 score ID。
删除 contracts 无消费者的 sha256JsonRef。不新增跨请求 hash 缓存或统一 hash 框架。
对应包测试及题集抽样覆盖这些规则。

### 诊断与回归

21 篇真实通知 fixture 包含原 19 篇和差异审阅发现的 244736、357596。
测试断言值与上下文的关系、错误父项排除、原文覆盖与证据长度，不锁死 chunk ID 或总数。
构造反例覆盖长字段、长人物记录、条件父项、时间、URL、非表格分号及跨章节二维码说明。

表头缺失诊断同时扫描原文分号表，避免未生成 table part 就漏报；括号标签加入现有诊断。
这些数值仅是人工调查候选，未改为发布门禁。348745 的扫码说明没有文本值且后接新章节，
保留边界，不跨章寻找值。

## 未采用方案

- 增大块长或固定 overlap 能增加邻近内容同现机会，但不能纠正章节归属和列含义；本轮保持长度参数。
- 只修 retrievalText 成本较小，却不能补全旧 publisher 交给模型的正文；因此同步修改真实证据发布。
- 新增 evidenceText 或在线相邻块扩展可以显式管理证据，但现有字段足够，本轮不增加另一套合同。
- 按通知 ID、标题写特例最容易贴合样例，但没有通用归属能力；当前实现只判断原文结构和相邻关系。
- 改读 HTML 或模型分块可利用额外信息，但会改变唯一输入或运行依赖；没有采用，也不推测附件、图片内容。
- 单纯增加检索 Top K 可以掩盖拆散关系；继续使用实际 24 条候选、reranker 与证据预算验证。

## 后果

### 身份清理验证

同一 v10 快照的 2,845 篇、13,488 块独立重建两次一致；除 chunkId 外，逐块正文、检索文本、
章节及来源范围完全不变，共 13,193 个唯一检索文本。新定位不需要重新生成这些已有文本的向量；
首次迁移仍会生成新的 chunks/set 身份，并需按既有流程发布 collection 才能在线使用。
开发 seed 已切换到新 set，复用已提交向量，未调用 Provider。

回归覆盖审查和算法标签变化不影响 serving chunks/set、同位置文本变化选择新向量、相同文本
复用缓存、v2 发布不读取审查文件、旧 Run 读取与缺日期时拒绝新发布，以及清理器保护共享 chunks 和旧版本引用。
本轮实现保持与共享 collection 的发布边界分离。

受影响的 Notice、统一 publisher、Campus Docs、eval、artifact worker、Go 包、类型检查、生产构建、
seed 导入和文档检查覆盖这些行为；提交校验同步补齐 bootstrap 测试预期中漏列的既有 PostgreSQL
备份策略，未改变部署权限。

### v10 扩大采样修复

新增四篇问题原文和 358295 正向对照，真实 fixture 从 21 篇增至 26 篇。回归验证报告人/时间对应、
超长报告题目、赛道通用资格及结束边界、纸质材料阶段、普通段落标签和同一行续块；另保留报送指令、
参会人员列表不被误提升为标题的反例。

同一 2,845 篇快照重建为 13,488 块，26 篇证据文本改变，2,819 篇不变；全部通过来源覆盖、证据长度检查，
两次构建完全一致。逐篇检查 26 篇证据文本差异，新增标题仅来自时刻/日期阶段，报告和赛道关系得到保留，
移除的普通文本首行标签未再无依据地限定后续段落。全量快照与差异属于离线结构验证输入；
本轮不改变 embedding 和 collection 的发布边界。
下方 v8/v9 检索结果不代表 v10 的在线检索行为。

### 本地结构与合同验证

同一 2,845 篇快照：v8 为 12,814 块，v9 为 13,479 块。431 篇 retrievalText 改变，2,414 篇不变。
两次独立构建逐字节一致；原文覆盖、来源范围、正式章节和证据长度检查零失败。
除表头的展示前缀外，全部补充上下文均能在同篇原文中定位。

检查了全部 22 篇正式标题变化及 22 篇新增表格识别；按字段、列表、普通文本、表格各抽查 10 篇，
发生变化的人物记录只有 1 篇，全部检查；另抽查 30 篇输出未变的正常通知。
差异审阅发现并修复了报送/提交标题留在上一项、父条件被同级列表继续吸收、长记录续块姓名值丢失。
这些抽查不等于每个候选边界都已人工验收，也不代表全语料没有既有结构问题。
例如 356052 的括号时刻标题在两版都未识别，返回正文仍包含完整标题与内容，未在本轮扩大修复。

已运行 notice-index-publisher 160 项单测、统一 publisher 29 项单测（另有 1 项既有集成跳过）、
两包类型检查与生产构建、execution-control 两个受影响包的 Go test/vet，以及文档检查。
Go 集成回归验证了真实 adapter 的重排请求、版本消费和接近 4,000 字预算时完整保留三条证据。

### 固定问题检索结果

固定 77 题：19 个已知问题、50 个原始正常对照，以及补充的 8 个流程、条件、多事实对照。
原 50 题偏重联系人和日期，补充题扩大覆盖但仍不是业务流量的随机代表样本。
答案与证据先从原文标注，两个版本使用同一题集。354886 的公众号渠道以原文操作行作为证据，
避免把 v8 不发布的正式标题当作正文片段；没有剔除 v8 拆散的已知问题。

向量采用 Qwen3-Embedding-4B、2,560 维，缓存 target 为
`651ca4ec3d467184c4d151db1181c49a0d59ba227068b3c50bf62e5439d35f1b`。
查询采用当前 Go consumer 的检索 instruction（包含 `relevant current passages`），
完整文本见 `apps/campus-search/internal/outbound/campus_docs.go`。
早期试跑缺少 `current` 的结果不用于下表。证据覆盖按各版真实发布 text 计算，独立于原文覆盖验证。

| 指标 | v8 | v9 |
| --- | --- | --- |
| dense 完整证据 Recall@1 | 39/77 | 51/77 |
| dense 完整证据 Recall@3 | 65/77 | 72/77 |
| dense 完整证据 Recall@5 | 68/77 | 72/77 |
| dense 完整证据 Recall@10 | 74/77 | 75/77 |
| 完整答案证据 MRR | 0.682040 | 0.793157 |
| 已知问题 dense Recall@3 | 12/19 | 19/19 |
| 混合召回＋重排＋预算：已知问题 | 15/19 | 19/19 |
| 混合召回＋重排＋预算：原正常对照 | 50/50 | 50/50 |
| 混合召回＋重排＋预算：补充对照 | 8/8 | 8/8 |

受控混合对照使用独立测试 collection，两组分别加入相同通知快照的 v8/v9 points。
使用 dense+sparse RRF、24 条候选、Qwen3-Reranker-4B、0.5 阈值、五条结果及 4,000 字预算，
不写共享索引或数据库。

v8 在日期时段（245266、246048）、招聘父项（248235）和发言人（348460）四题中，
证据进入候选后在重排/结果筛选环节失去必要关系；v9 四题全部完整。
354919 的 dense 证据名次从 5 到 7：四篇相同正文向量分数同为 0.67083672，
算法升级改变 chunk ID，导致并列排序改变；实际重排结果仍完整，不是新增证据丢失。

结果中的重复上下文和混入其他来源不作为本次优化目标；完整证据覆盖也不能证明模型会正确使用所有返回内容。

固定问题及回归原文由 `test/fixtures/` 维护；评测结论依赖同一快照和模型配置，
不能把日后更新的在线通知视为相同实验输入。

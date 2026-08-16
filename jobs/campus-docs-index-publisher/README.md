# Campus Web 文档索引发布

该任务只消费对象存储中的 `campus-docs/source.json` 及其引用的
`campus_docs_reader.v3` 阅读正文。`source.json` 是控制清单，不是可检索正文；正文的唯一来源是
清单中每个文档当前版本的 reader 对象。

publisher 代码内的 `INDEX_DEFINITION` 固定分块、embedding provider/model/dimensions、查询指令、
point schema 和 sparse 向量。运行环境必须另外显式提供非敏感 `embedding_space_id`，标识实际
embedding 模型权重及修订；endpoint 和凭据不参与该身份。collection 名是当前文档投影、索引定义和
`embedding_space_id` 的 SHA-256：`campus_docs_<sha256>`。当前投影只包含会影响 points 的文档目录、
身份、标题、当前版本 ID/slug/label 和 reader 对象引用；历史版本、redirect、topic 描述和清单 JSON
格式不参与 collection 身份。

当前 `campus_docs_reader_elements.v3` 以 Unicode 字符计数，软目标 800、硬上限 1600，不做重叠。
正文切分不会拆开小数、数字千分位、时间、域名或版本号。表格序列化保留物理单元格身份和多级语义
表头：跨列值只输出一次，跨行正文上下文逐行保留，相邻同值合并列路径，空值省略；无表头表格按
非空物理值阅读顺序输出，不生成通用列名。全表只有表头或空数据列仍保留非空表头文本。

任务按文档标题、完整标题路径和正文组成的检索文本 SHA-256 合并 embedding 输入。当前绑定的
`embedding_space_id`、provider、model 和 dimensions 全部一致时，它从旧 collection 复用未变化
检索文本的 dense vector，只为未命中的唯一检索文本调用 embedding provider；全部 payload 和
sparse vector 仍从当前 reader 重建。point v3 同时保存版本 ID、版本 slug、版本标签和指向该版本的
公开 `section_ref`。

任务为每次有效输入变化构建新的不可变 Qdrant collection，完成 point 数、payload 和双向量校验后，
原子替换 PostgreSQL `campus_docs_serving.current_index` 单行绑定。激活前会重新读取 `source.json`；
构建期间当前文档选择发生变化会拒绝切换。激活前失败会删除新 collection，数据库激活结果不确定时
保留已验证 collection，避免删除可能已成为当前值的索引。

publisher 使用 PostgreSQL session advisory lock 保证单实例运行。目标 collection 已存在时先验证：
尚未激活的候选内容完整时直接激活，确定性内容不匹配时删除重建，网络或 HTTP 错误不删除。目标已经
是当前绑定时仍执行完整校验；物理 collection 缺失则按同一确定性名称重建，已存在但内容损坏则停止
且绝不删除当前 collection。运行输出包含 collection、来源摘要和文档数；实际构建还报告 point、唯一
embedding 输入、复用输入和新生成输入数。

文档更新不会原地修改旧 collection。当前仓库不维护索引历史表、自动清理状态机或旧 collection
保留策略；已准入 run 仍只使用其冻结的 collection。

运行：

```bash
pnpm --dir jobs/campus-docs-index-publisher publish
```

发布器需要显式提供对象存储、PostgreSQL、Qdrant 和 embedding provider 凭据，并通过
`CAMPUS_DOCS_EMBEDDING_SPACE_ID` 声明本次生成向量的空间身份。凭据只存在于任务进程；space ID
写入当前索引绑定，但不写入 point payload。

环境通过保持暂停的 `CronJob/campus-docs-index-publisher` 创建手动 Job。来源维护、运行核对和人工
清理步骤见 `docs/runbooks/campus-docs.md`。

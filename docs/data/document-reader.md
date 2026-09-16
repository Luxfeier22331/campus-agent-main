---
doc_type: data
owner_boundary: data-plane/document-reader
status: active
---

# 文档阅读器数据模型

## 文档边界

本文定义公开文档阅读、站内搜索、来源卡片和 Campus Docs 索引输入共享的标识与数据边界。字段由
JSON Schema 维护，来源发布、静态构建和界面由 Campus Web 维护；Docs builder 与统一 Campus RAG serving
publisher 由检索服务维护。

```text
来源资料 -> 整理后的 reader v3、课程图来源与图片 -> campus_docs_source.v4 -> 静态阅读资产
```

本文定义共享文档输入和派生索引制品的存储布局，不定义具体分块、索引发布或在线查询行为。

## 稳定标识

- `docId`：一份逻辑文档；
- `versionId` 与 `versionSlug`：一份文档版本；
- `routeSlug`：文档公开路由片段；
- `anchor`：章节内的稳定导航位置；
- `rootUnitId`：搜索命中、来源卡片和临时高亮使用的正文单元。

`chunkId`、对象存储路径和来源文件名不能进入用户 URL。重新分块、更换搜索引擎或修改界面不得改变
这些公开标识的含义。

## 来源清单

`campus_docs_source.v4` 是 Campus Web 构建与 Campus Docs Chunk builder 共享的文档控制清单，包含集合、
主题、文档、版本、旧正文重定向和来源对象引用。Docs builder 只读取文档、当前版本和 reader 引用；
它不把清单自身作为正文索引。

### 集合与主题

集合包含 `corpus`、`collection`、`displayName` 和可选说明。公开培养方案集合为：

- `undergraduate`：本科培养方案；
- `second_degree`：二学位培养方案；
- `general_education`：通识教育。

规章的 `institutional_rules`、`scoped_rules` 和 `student_rules` 表示来源所有权；公开侧栏再由
`topics[]` 和文档的 `topicId` 分组。主题只影响阅读目录，不改变集合、文档或版本。

### 文档与版本

文档包含 `docId`、`documentSlug`、所属集合和标题。版本按同一文档内的数字 `versionSlug` 排序，数值
最大的版本是当前版本。已知年份使用四位年份，年份未知时使用从 `1` 开始的顺序号，同一文档不能混用
两种形式。

版本只包含 `versionId`、`versionSlug`、所属 `docId`、reader 正文对象引用和补充资产引用。当前版本由
构建选择；Campus Web 从 `versionSlug` 生成“2026 年版”或“第 1 版”等展示文本。当前版本使用文档固定
链接，所有版本也提供 `/v/<versionSlug>` 固定别名。

### 对象引用

每个来源对象引用包含：

- `key`：环境 bucket 内的对象键；
- `byteSize`：精确字节数；
- `sha256`：带 `sha256:` 前缀的内容摘要。

Campus Web 发布命令和构建都按字节数与摘要核对对象。固定来源清单位于
`campus-docs/source.json`；reader、课程图来源和图片由该清单明确引用。

来源清单是完整期望状态。其全部 reader、补充对象和补充图片引用共同构成对象存储存活集合；对象是否
存在于 bucket、上传时间或路径前缀本身不赋予消费资格。RAG 只选择每份文档的当前 reader，Campus Web
仍读取清单中的历史版本和补充对象。

## Reader

`campus_docs_reader.v3` 是唯一公开正文格式，包含：

- `docId` 与 `versionId`；
- 按来源阅读顺序保存的 `elements[]`；
- 本正文使用的补充数据声明。

文档标题来自来源清单，不在 reader 内重复保存一级标题。`heading` 元素包含 `anchor`、`level`、
`rootUnitId` 和 `text`，其中 `level` 只允许 2 至 6。Campus Web 不重排元素、不根据正文生成章节，
也不从其他对象补全 reader。

正文元素包含 `rootUnitId` 和以下一种结构：

- `heading`：带稳定锚点和层级的标题；
- `paragraph`：纯文本，空行分隔独立显示的段落；
- `list`：纯文本，每个非空行是一项，来源编号保留在正文中；
- `blockquote`：纯文本引用；
- `table`：二维单元格、语义表头标记及可选 `rowSpan`、`colSpan`。`header: true` 表示该单元格在
  表格结构中承担表头语义，不是对来源 HTML `<th>` 的机械复制；多级表头的每一层都必须正确标记。

表格应用跨度后必须形成完整矩形网格。跨度不得重叠或超出表格行数；空白内容以显式空单元格表示，
Campus Web 不补齐缺失列或推断合并范围。

Reader 不保存 HTML、检索分块、搜索摘要、集合元数据或对象存储地址。标题和正文是整理流程提供的
显示文本；Campus Web 只校验其结构和稳定标识。

## 课程图

来源清单中的课程图补充数据由提取结果和一个或多个图片组成。Campus Web 构建生成
`campus_docs_course_maps.v1`，reader 只登记补充类型和入口路径。

每张逻辑图保存 `mapId`、显示标题、目标 `rootUnitId` 和一个或多个原图切片。切片尺寸从真实图片
读取，用于浏览器预留版面。浏览器公开数据不包含来源提取节点、边、状态或备注。

同一页、标题和父标题相同且满足相邻条件的图片切片合并为一张逻辑图。课程图关联必须落到 reader
中已存在的正文单元，不能根据正文语义自由推测。

## 浏览器数据

公开站点索引、搜索索引、预渲染 HTML 和 `/_docs/**` 资产都从同一来源摘要派生；具体产物版本、字段
和构建校验由[文档来源与静态交付合同](../contracts/document-reader-delivery.md)维护。公开正文和历史版本
使用稳定链接，历史版本不进入普通搜索。

浏览器先使用 HTML 内的路由数据完成首次显示，再读取同源静态 JSON 增强站内切换。所有数据均公开，
不需要会话、文档 API 或服务端权限判断。

## 来源卡片

阅读目标包含 `docId`、`versionId`、`versionSlug`、固定链接、`anchor` 和
`highlightRootUnitIds[]`。历史版本与当前版本都提供 `/v/<versionSlug>` permalink；普通文档导航仍
使用当前版本的无版本 URL。来源卡片只携带用户可见标题、摘要、`versionSlug` 和固定阅读目标，显示
标签由 Campus Web 生成；卡片不包含检索分数、对象存储位置或供应商响应。

## 存储边界

来源清单及其引用对象由对象存储保存，公开静态内容由不可变 Worker version 携带；产品 PostgreSQL
不保存文档投影，App API 不读取、选择或转发公开文档。Campus Docs 当前索引的绑定由统一 Campus RAG
serving publisher 写入 serving schema。

公开 slug 变化必须同时登记旧路径 `308`。

## Campus Docs 索引制品

Campus Docs 的分块与向量制品使用以下内容寻址布局：

```text
campus-docs/rag/chunk-data/sha256/<digest>/chunks.ndjson
campus-docs/rag/chunk-sets/sha256/<id>/manifest.json
campus-docs/rag/embedding-data/sha256/<digest>/embeddings.ndjson
campus-docs/rag/embedding-sets/sha256/<id>/manifest.json
```

线上制品位于 derived bucket。本地构建在当前 worktree 的 `var/` 下使用相同相对布局，因此 manifest
中的对象引用不因存储实现而改变。分块身份、Embedding Set 和发布语义由
[检索服务](../architecture/system/retrieval-serving.md)维护。

## 不负责

- 来源资料采集与保存；
- 检索分块、向量索引发布和在线运行准入；
- 文档站界面样式；
- Worker 环境版本选择；
- 运维观测中的原始来源记录。

## 相关文档

- [文档站架构](../architecture/system/document-site.md)
- [数据链](../architecture/system/data-plane.md)
- [文档来源与静态交付合同](../contracts/document-reader-delivery.md)
- [来源卡片](../domains/source-card.md)
- [文档历史 ADR](../../.agents/notes/implemented/feature/2026-07-16-document-history.md)

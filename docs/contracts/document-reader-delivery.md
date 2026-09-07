---
doc_type: contract
owner_boundary: docs/contracts
status: active
---

# 文档来源与静态交付合同

## 边界

本文定义整理后的 reader、对象存储来源清单和 Campus Web 构建之间的一致性。App API、产品数据库、
浏览器会话、知识检索和访问准入不参与公开文档的来源更新与静态读取。

## 可执行合同

现行格式由以下 schema 定义：

- `campus-docs-source.v4.schema.json`：主题、文档、版本、旧正文路由、reader 和补充资产来源；
- `campus-docs-reader.v3.schema.json`：Campus Web 唯一接受的正文格式；
- `campus-docs-course-maps.v1.schema.json`：Campus Web 构建生成的课程图公开格式；
- `campus-docs-site-index.v5.schema.json`：构建派生的公开主题、集合、版本、搜索入口和旧正文路由；
- `campus-docs-search-index.v2.schema.json`：构建从当前版本正文派生的搜索索引。

字段和校验规则以 schema 与实现为准。旧发布清单、当前版本指针、数据库投影和旧站点索引不是兼容
输入。

## 数据流

```text
来源系统生成 reader、课程图来源和图片
-> 来源系统写入对象存储并记录 key、byteSize、sha256
-> 整理流程生成 campus_docs_source.v4
-> Campus Web 来源提交入口完整校验并写入固定来源清单
-> Campus Web 构建读取固定来源键并再次校验
-> 构建进程复制 reader 并生成最终课程图
-> 构建派生站点索引、内容寻址搜索索引、静态资产和预渲染 HTML
```

静态交付链不建立独立 reader 发布 Job、reader 中间对象或第二个发布版本指针。检索服务拥有的
Campus Docs Chunk builder 读取同一固定来源键，随后由统一 Campus RAG serving publisher 消费显式
Docs/Notice 制品；这两条链路都不属于本合同定义的静态产物链。

## 来源要求

来源清单必须满足：

- 文档属于已支持集合，文档、版本、路由和主题标识不重复；
- 规章文档引用有效主题，培养方案文档不引用规章主题；
- 每份文档至少有一个版本；版本 slug 为四位年份或正整数序号，同一文档内不得混用，数值最大的版本
  由构建派生为当前版本；
- 每个版本引用一份与 `docId`、`versionId` 一致的 reader 对象；
- 每个对象引用包含实际字节数和 SHA-256；
- 补充数据与图片使用安全相对路径，同一版本内目标路径不重复；
- 旧路由只从已退役正文地址指向来源清单中的正文固定链接，不登记领域或集合目录。

清单是完整当前期望集合，不是增量操作记录。新增和修订对象必须先写入对象存储，固定来源键最后更新；
删除文档通过从完整清单移除对应文档和版本表达。未被清单引用的 bucket 对象不属于交付输入。

公开培养方案集合固定为 `undergraduate`、`second_degree` 和 `general_education`。规章来源集合固定为
`institutional_rules`、`scoped_rules` 和 `student_rules`，公开目录再按来源清单中的主题组织。
集合和主题必须由来源整理流程明确填写，构建不得根据标题或文件名推断。

## 正文要求

每个版本的 reader 是已整理的公开正文。它必须使用 `campus_docs_reader.v3`，并按阅读顺序提供
`elements[]`。元素只能是 `heading`、`paragraph`、`list`、`blockquote` 或 `table`；标题有唯一
`anchor` 和 2 至 6 的层级，所有元素的 `rootUnitId` 唯一。文档标题仍由来源清单提供，不在 reader
中重复保存一级标题。

`paragraph.text` 使用空行分隔需要独立显示的段落；单个换行不能代替段落边界。`list.text` 每个非空行
表示一个列表项，保留来源中的编号文字。Campus Web 不再额外生成项目符号。来源整理流程不能把多个
明确编号的项目折叠在一个只有单换行的 `paragraph` 中，也不能保留 `migrated-heading-*` 迁移占位
元素或用多行 pipe 文本代替 `table`。

`table` 的单元格按行提供；应用 `rowSpan` 和 `colSpan` 后，每行必须占据相同且连续的逻辑列。
跨度不得相互重叠或超过表格行数，有意留空必须提供 `text: ""` 的显式单元格或正确跨度。来源整理
流程不得省略空单元格并让 Campus Web 猜测表格结构。`header` 表示语义表头，多级表头的每层均应
标记为 `true`；不得仅按来源是否使用 HTML `<th>` 机械映射。

Campus Web 不从检索分块、HTML、文件名或其他对象重建阅读结构，也不进行版本兼容转换。reader 的
摘要、字节数、身份、元素标识和补充声明任一不一致时，构建直接终止。

## 课程图

来源清单引用课程图提取结果和原图。构建读取真实图片尺寸，生成
`campus_docs_course_maps.v1`，并将逻辑图关联到 reader 中明确存在的 `rootUnitId`。

同一页、标题和父标题相同，横向间距不超过 24 个来源坐标单位且垂直重叠不少于较矮图块 80% 的
相邻切片合并为一张逻辑图。课程图优先匹配“课程地图”的直接子章节；剩余图与剩余子章节数量一致时
按来源顺序关联，否则关联明确的父章节。无法找到唯一父章节、图片缺失、尺寸不符或出现未引用图片时
终止构建。

浏览器课程图只包含逻辑图标识、标题、目标 `rootUnitId`、图片相对路径和尺寸，不公开来源提取节点、
边和备注。

## 来源提交

固定来源清单及其引用对象的布局由
[文档阅读器数据模型](../data/document-reader.md)维护。来源提交入口先解析 schema、规范化排序、核对关系并
完整编译所有版本；只有全部成功后才替换固定来源清单，随后回读并逐字节核对。编译失败不得修改当前
来源。对象存储地址和凭据不写入来源清单。具体更新操作见
[Campus Docs 维护与索引发布](../runbooks/campus-docs.md)。

来源对象引用仍按摘要核对。reader 原件保存在对象存储；最终课程图只存在于 Campus Web 的本次构建
目录及最终静态产物中，不回写对象存储。

## 构建核对

Campus Web 开发和构建入口都必须：

1. 读取固定来源清单，确认它是规范化的 `campus_docs_source.v4` JSON；
2. 以来源清单精确字节的 SHA-256 选择本地缓存目录；
3. 核对每份 reader、课程图来源和图片的字节数与摘要；
4. 校验 reader v3 的身份、元素、标题锚点和表格；
5. 生成并校验课程图身份、图片、目标正文单元和尺寸；
6. 确认每份文档恰有一个当前版本，旧路由只指向已生成正文；
7. 将所有公开复制目标限制在本次构建的 `/_docs/**` 目录。

任一条件失败都终止 Campus Web 受信任正式构建，不猜测其他对象，不读取数据库或旧接口补齐。

本地缓存位于：

```text
.generated/docs-content/sources/sha256-<source-digest>
```

开发服务复用同一缓存但不生成全部 HTML；正式构建从同一来源摘要生成全部页面。构建不接受样本内容、
手工版本标识、`latest` 或对象列表顺序。

`CAMPUS_WEB_BUILD_TARGET` 只区分应用和文档两次 Vite 构建，`CAMPUS_WEB_DOCS_CONTENT_ROOT` 只传递
来源摘要对应的本地准备目录。两者均为构建进程内部变量，不进入 Worker、Wrangler、Argo 或 GitHub
Environment。`OBJECT_STORE_ENDPOINT`、`OBJECT_STORE_DERIVED_READ_ACCESS_KEY` 和
`OBJECT_STORE_DERIVED_READ_SECRET_KEY` 是正式构建读取来源和文档对象的输入；受信任的来源更新
命令另行使用 `OBJECT_STORE_DERIVED_ACCESS_KEY`、`OBJECT_STORE_DERIVED_SECRET_KEY` 写入身份。
读身份不具备写入能力，所有这些变量都不传给 Vite 子进程，也不写入静态产物。

PR job 不访问对象存储；Campus Web 只执行无对象存储依赖的 `build:worker` 测试构建。main/artifact
lane 的独立 Campus Web publisher 使用 Source staging Environment 的公网对象存储端点和只读身份
执行正式 `build:staging` 并上传 Worker version。该 publisher 不是独立文档发布 Job，不写回文档来源
或维护第二个文档版本指针。

## 构建产物

一次构建生成：

- `build/catalog.json`：仅供构建和预渲染使用的完整路由目录；
- `public/_docs/site-index.json`：`campus_docs_site_index.v5`；
- `public/_docs/search/sha256/<digest>.json`：当前版本的内容寻址搜索索引；
- `public/_docs/**`：全部版本的 reader、最终课程图和图片；
- `pages/docs/**/index.html`：目录、正文、历史版本和专用 404 页面。
- `public/_headers`、`public/_redirects`：静态文档的响应头和旧正文重定向。

`/docs` 是唯一目录页。培养方案集合和规章主题只在侧边栏与移动端目录中展开，不生成领域或集合
目录页。`/docs/<corpus>` 与 `/docs/<corpus>/<collection>` 返回真实 `404`。当前版本同时生成无版本
canonical URL 和 `/v/<versionSlug>` 固定别名；历史版本可直接阅读，但不进入普通搜索。

旧正文重定向只由来源清单维护。Campus Web 将其写入静态 `_redirects`，不在 Worker 维护第二份映射。

## 候选一致性

构建把 `sourceDigest` 写入 `.docs-source.json` 和 Worker 候选元数据。它不是 Worker 运行变量，也
不是环境流量指针。一个不可变 Worker version 自带对应的目录、搜索索引、正文和图片；环境回滚到该
version 时同时回滚全部文档静态内容。

文档来源或构建失败只阻止 Campus Web 候选，不阻塞 App API、认证或其他独立服务。已部署文档不因
产品数据库不可用而失去读取能力。

## 操作入口

- 来源更新、Campus Web 刷新与检索索引操作：`docs/runbooks/campus-docs.md`；
- 环境选择与候选发布：`docs/runbooks/release.md`；
- 数据对象定义：`docs/data/document-reader.md`。

## 相关文档

- [文档站架构](../architecture/system/document-site.md)
- [文档阅读器数据模型](../data/document-reader.md)
- [运行时发布](../architecture/system/runtime-release.md)
